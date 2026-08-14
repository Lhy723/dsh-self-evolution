import type { Context } from '@deepseek-ai/cordis'
// Side-effect type import: activates the `ctx.subagents` Context augmentation
// declared by the real dsh-subagent package.
import type {} from '@deepseek-ai/dsh-subagent'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type {
  CandidateOperation,
  CandidateProposal,
  EvaluatorJudgement,
  EvaluatorRequest,
  EvaluatorResult,
  OptimizerRequest,
  OptimizerResult,
  ResolvedEvolutionConfig,
  TargetRequest,
  TargetResult,
  WorkerRuntime,
} from './types.js'
import { composeTargetPersona, mergeAgentOptions } from './profile.js'
import {
  EVALUATOR_OUTPUT_SCHEMA,
  evaluatorPersona,
  evaluatorPrompt,
  OPTIMIZER_OUTPUT_SCHEMA,
  optimizerPersona,
  optimizerPrompt,
  targetTaskPrompt,
} from './prompts.js'
import { EvolutionError, textFromContentBlocks } from './util.js'

function combineToolFilter(
  requested: { allow?: string[]; deny?: string[] } | undefined,
  forcedDeny: readonly string[],
): { allow?: string[]; deny?: string[] } | undefined {
  const deny = new Set([...(requested?.deny ?? []), ...forcedDeny])
  const allow = requested?.allow?.filter(name => !deny.has(name))
  if (allow !== undefined) return { allow, ...(deny.size === 0 ? {} : { deny: [...deny] }) }
  if (deny.size > 0) return { deny: [...deny] }
  return undefined
}

function ensureObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EvolutionError(`${label} did not return a structured object`, 'INVALID_WORKER_OUTPUT')
  }
  return value as Record<string, unknown>
}

function parseEvaluator(value: unknown): EvaluatorJudgement {
  const object = ensureObject(value, 'evaluator')
  if (typeof object.valid !== 'boolean') throw new EvolutionError('evaluator.valid must be boolean', 'INVALID_WORKER_OUTPUT')
  if (typeof object.score !== 'number' || !Number.isFinite(object.score) || object.score < 0 || object.score > 100) {
    throw new EvolutionError('evaluator.score must be between 0 and 100', 'INVALID_WORKER_OUTPUT')
  }
  for (const key of ['publicFeedback', 'privateNotes'] as const) {
    if (typeof object[key] !== 'string') throw new EvolutionError(`evaluator.${key} must be a string`, 'INVALID_WORKER_OUTPUT')
  }
  if (!Array.isArray(object.behaviorTags) || object.behaviorTags.some(tag => typeof tag !== 'string')) {
    throw new EvolutionError('evaluator.behaviorTags must be an array of strings', 'INVALID_WORKER_OUTPUT')
  }
  return {
    valid: object.valid,
    score: object.score,
    publicFeedback: object.publicFeedback as string,
    privateNotes: object.privateNotes as string,
    behaviorTags: object.behaviorTags as string[],
  }
}

function parseOperation(value: unknown, index: number): CandidateOperation {
  const object = ensureObject(value, `optimizer.operations[${index}]`)
  if (object.op !== 'upsert' && object.op !== 'delete') {
    throw new EvolutionError(`optimizer.operations[${index}].op is invalid`, 'INVALID_WORKER_OUTPUT')
  }
  if (typeof object.path !== 'string') {
    throw new EvolutionError(`optimizer.operations[${index}].path must be a string`, 'INVALID_WORKER_OUTPUT')
  }
  if (object.op === 'upsert') {
    if (typeof object.content !== 'string') {
      throw new EvolutionError(`optimizer.operations[${index}].content must be a string`, 'INVALID_WORKER_OUTPUT')
    }
    return { op: 'upsert', path: object.path, content: object.content }
  }
  return { op: 'delete', path: object.path }
}

function parseOptimizer(value: unknown): CandidateProposal {
  const object = ensureObject(value, 'optimizer')
  for (const key of ['hypothesis', 'expectedBehavior', 'summary'] as const) {
    if (typeof object[key] !== 'string') throw new EvolutionError(`optimizer.${key} must be a string`, 'INVALID_WORKER_OUTPUT')
  }
  if (!Array.isArray(object.operations)) throw new EvolutionError('optimizer.operations must be an array', 'INVALID_WORKER_OUTPUT')
  return {
    hypothesis: object.hypothesis as string,
    expectedBehavior: object.expectedBehavior as string,
    summary: object.summary as string,
    operations: object.operations.map(parseOperation),
  }
}

export class DshSubagentWorker implements WorkerRuntime {
  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedEvolutionConfig,
    private readonly evolutionToolNames: readonly string[],
  ) {}

  private async executeStructured(input: {
    parent: TargetRequest['parent']
    signal: AbortSignal
    label: string
    persona: string
    prompt: string
    outputSchema: ObjectJsonSchema
    agentOptions?: AgentOptions
  }): Promise<{ sessionId: string; stopReason: string; durationMs: number; structured: unknown }> {
    const startedAt = Date.now()
    const run = await this.ctx.subagents.start(this.config.subagentProvider, {
      label: input.label,
      parent: input.parent,
      signal: input.signal,
      prompt: [{ type: 'text', text: input.prompt }],
      persona: input.persona,
      outputSchema: input.outputSchema,
      toolFilter: { allow: [] },
      maxDepth: this.config.maxDepth,
      ...(input.agentOptions === undefined ? {} : { agentOptions: input.agentOptions }),
    })
    try {
      const result = await run.result
      if (result.stopReason !== 'completed') {
        throw new EvolutionError(
          `${input.label} subagent ended with ${result.stopReason}: ${textFromContentBlocks(result.output)}`,
          'WORKER_FAILED',
          { sessionId: String(run.id), stopReason: result.stopReason },
        )
      }
      if (result.structured === undefined) {
        throw new EvolutionError(`${input.label} did not produce structured output`, 'INVALID_WORKER_OUTPUT', {
          sessionId: String(run.id),
        })
      }
      return {
        sessionId: String(run.id),
        stopReason: result.stopReason,
        durationMs: Date.now() - startedAt,
        structured: result.structured,
      }
    } finally {
      await run.dispose()
    }
  }

  async runTarget(request: TargetRequest): Promise<TargetResult> {
    const startedAt = Date.now()
    const toolFilter = combineToolFilter(request.toolFilter, this.evolutionToolNames)
    const agentOptions = mergeAgentOptions(
      request.parent.options,
      request.profile.runtime.agentOptions,
      this.config.targetAgentOptions,
      request.agentOptions,
    )
    const run = await this.ctx.subagents.start(this.config.subagentProvider, {
      label: `benchmark ${request.benchmarkCase.id} run ${request.runIndex}`,
      parent: request.parent,
      signal: request.signal,
      prompt: [{ type: 'text', text: targetTaskPrompt(request.benchmarkCase, request.profile, request.runIndex) }],
      persona: composeTargetPersona(request.profile),
      maxDepth: this.config.maxDepth,
      ...(toolFilter === undefined ? {} : { toolFilter }),
      ...(agentOptions === undefined ? {} : { agentOptions }),
    })
    try {
      const result = await run.result
      const output = textFromContentBlocks(result.output)
      if (result.stopReason !== 'completed') {
        throw new EvolutionError(
          `target agent ended with ${result.stopReason}${output ? `: ${output}` : ''}`,
          'TARGET_FAILED',
          { sessionId: String(run.id), stopReason: result.stopReason },
        )
      }
      return {
        sessionId: String(run.id),
        output,
        stopReason: result.stopReason,
        durationMs: Date.now() - startedAt,
      }
    } finally {
      await run.dispose()
    }
  }

  async runEvaluator(request: EvaluatorRequest): Promise<EvaluatorResult> {
    const executed = await this.executeStructured({
      parent: request.parent,
      signal: request.signal,
      label: `evaluate ${request.benchmarkCase.id} run ${request.runIndex}`,
      persona: evaluatorPersona(),
      prompt: evaluatorPrompt(request),
      outputSchema: EVALUATOR_OUTPUT_SCHEMA,
      ...mergeAgentOptions(request.parent.options, this.config.evaluatorAgentOptions, request.agentOptions) === undefined ? {} : { agentOptions: mergeAgentOptions(request.parent.options, this.config.evaluatorAgentOptions, request.agentOptions) as AgentOptions },
    })
    const judgement = parseEvaluator(executed.structured)
    return { ...judgement, sessionId: executed.sessionId, stopReason: executed.stopReason, durationMs: executed.durationMs }
  }

  async runOptimizer(request: OptimizerRequest): Promise<OptimizerResult> {
    const executed = await this.executeStructured({
      parent: request.parent,
      signal: request.signal,
      label: `optimize profile v${request.profile.runtime.version}`,
      persona: optimizerPersona(),
      prompt: optimizerPrompt(request, this.config),
      outputSchema: OPTIMIZER_OUTPUT_SCHEMA,
      ...mergeAgentOptions(request.parent.options, this.config.optimizerAgentOptions, request.agentOptions) === undefined ? {} : { agentOptions: mergeAgentOptions(request.parent.options, this.config.optimizerAgentOptions, request.agentOptions) as AgentOptions },
    })
    return {
      sessionId: executed.sessionId,
      stopReason: executed.stopReason,
      durationMs: executed.durationMs,
      proposal: parseOptimizer(executed.structured),
    }
  }
}
