import path from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  EvaluateOptions,
  EvolutionPluginConfig,
  EvolutionSummary,
  RunEvolutionOptions,
  StatusSummary,
} from './types.js'
import { resolveConfig } from './config.js'
import { EvolutionEngine } from './engine.js'
import { DshSubagentWorker } from './worker.js'
import { EvolutionError } from './util.js'

export type Config = EvolutionPluginConfig

const optionalAgentOptions = z.object({
  provider: z.string(),
  model: z.string(),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
}).default(undefined as unknown as { provider: string; model: string; maxTokens: number })

export const Config = z.object({
  stateRoot: z.string().default('~/.dsh/self-evolution'),
  subagentProvider: z.string().default('spawn'),
  maxParallelEvaluations: z.number().step(1).min(1).default(4),
  minImprovement: z.number().min(0).default(0),
  maxCandidateOperations: z.number().step(1).min(1).default(12),
  maxCandidateBytes: z.number().step(1).min(1).default(262144),
  lockStaleMs: z.number().step(1).min(1).default(1800000),
  evaluationRetries: z.number().step(1).min(0).default(1),
  evaluatorRetries: z.number().step(1).min(0).default(2),
  optimizerRetries: z.number().step(1).min(0).default(1),
  allowBenchmarkInsideWorkspace: z.boolean().default(false),
  allowModelRouteMutation: z.boolean().default(false),
  managedFiles: z.array(z.string()).default([
    'AGENTS.md',
    'runtime.json',
    'skills/*/SKILL.md',
    'config/**/*.json',
    'config/**/*.md',
  ]),
  excludedFiles: z.array(z.string()).default([
    '.git/**',
    'node_modules/**',
    '.env',
    '.env.*',
    '.vault*',
    '**/.vault*',
    '**/*secret*',
    '**/*credential*',
    '**/*token*',
  ]),
  requiredFiles: z.array(z.string()).default(['AGENTS.md', 'runtime.json']),
  toolPrefix: z.string().default('evolution'),
  maxDepth: z.number().step(1).min(1).default(4),
  targetAgentOptions: optionalAgentOptions,
  evaluatorAgentOptions: optionalAgentOptions,
  optimizerAgentOptions: optionalAgentOptions,
})

const EVOLUTION_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    runId: { type: 'string', required: true },
    mode: { type: 'string', required: true },
    profilePath: { type: 'string', required: true },
    benchmarkId: { type: 'string' },
    baselineScore: { type: 'number' },
    finalScore: { type: 'number' },
    finalVersion: { type: 'number', required: true },
    acceptedRounds: { type: 'number', required: true },
    rejectedRounds: { type: 'number', required: true },
    stopReason: { type: 'string', required: true },
    runDirectory: { type: 'string', required: true },
    scoreboardPath: { type: 'string' },
    sessionIds: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    profilePath: { type: 'string', required: true },
    statePath: { type: 'string', required: true },
    currentVersion: { type: 'number', required: true },
    currentDigest: { type: 'string', required: true },
    actualDigest: { type: 'string', required: true },
    drifted: { type: 'boolean', required: true },
    nextVersion: { type: 'number', required: true },
    latestRunId: { type: 'string' },
    references: { type: 'json', required: true },
    snapshots: { type: 'array', required: true, items: { type: 'number' } },
  },
} as const

function requireCallingAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new EvolutionError('self-evolution tools require a calling Agent', 'MISSING_AGENT')
  return agent
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new EvolutionError(`${label} must be a positive integer`, 'INVALID_ARGUMENT')
  return resolved
}

function score(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new EvolutionError('target_score must be between 0 and 100', 'INVALID_ARGUMENT')
  }
  return value
}

export class SelfEvolutionService extends Service {
  static inject = ['tools', 'subagents']
  static Config = Config

  readonly resolvedConfig
  readonly toolNames: readonly string[]
  private readonly engine: EvolutionEngine

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolution')
    this.resolvedConfig = resolveConfig(config)
    const prefix = this.resolvedConfig.toolPrefix
    this.toolNames = [
      `${prefix}_run`,
      `${prefix}_evaluate`,
      `${prefix}_status`,
      `${prefix}_rollback`,
    ]
    const worker = new DshSubagentWorker(ctx, this.resolvedConfig, this.toolNames)
    this.engine = new EvolutionEngine(this.resolvedConfig, worker, ctx.logger)
    this.registerTools(ctx)
  }

  private resolveInputPath(parent: Agent, input: string): string {
    const workspace = parent.session.header.cwd ?? process.cwd()
    return path.isAbsolute(input) ? path.normalize(input) : path.resolve(workspace, input)
  }

  async evolve(parent: Agent, signal: AbortSignal, options: RunEvolutionOptions): Promise<EvolutionSummary> {
    return this.engine.evolve(parent, signal, options)
  }

  async evaluate(parent: Agent, signal: AbortSignal, options: EvaluateOptions): Promise<EvolutionSummary> {
    return this.engine.evaluate(parent, signal, options)
  }

  async status(profileDir: string): Promise<StatusSummary> {
    return this.engine.status(profileDir)
  }

  async rollback(parent: Agent, signal: AbortSignal, profileDir: string, version: number): Promise<EvolutionSummary> {
    return this.engine.rollback(parent, signal, profileDir, version)
  }

  private registerTools(ctx: Context): void {
    const [runName, evaluateName, statusName, rollbackName] = this.toolNames
    const service = this
    if (runName === undefined || evaluateName === undefined || statusName === undefined || rollbackName === undefined) {
      throw new Error('self-evolution tool name construction failed')
    }

    ctx.tools.register(defineTool({
      name: runName,
      description:
        'Run the complete benchmark-driven self-evolution loop for a managed Agent Profile: establish or reuse a baseline, '
        + 'delegate target runs and private scoring to subagents, ask an isolated optimizer for one bounded candidate per '
        + 'round, edit AGENTS.md/Skills/runtime config transactionally, re-evaluate, keep strictly better candidates, and '
        + 'roll back rejected candidates from verified snapshots. Private rubrics never enter optimizer context.',
      parameters: {
        profile_dir: { type: 'string', required: true, description: 'Managed profile directory containing AGENTS.md and runtime.json; relative paths resolve from the calling Agent workspace.' },
        benchmark_dir: { type: 'string', required: true, description: 'Frozen benchmark directory containing benchmark.json and private rubric files. Keep it outside the target workspace by default.' },
        rounds: { type: 'number', description: 'Maximum complete candidate rounds. Default 3.' },
        runs_per_case: { type: 'number', description: 'Independent target/evaluator runs per case for every candidate. Default 1.' },
        baseline_runs: { type: 'number', description: 'Runs per case when a matching baseline is not already recorded. Default 1.' },
        target_score: { type: 'number', description: 'Optional early-stop score from 0 through 100.' },
        adopt_external_changes: { type: 'boolean', description: 'Adopt a manually changed managed profile as a new version instead of failing on digest drift. Default false.' },
      },
      output: {
        schema: EVOLUTION_SUMMARY_SCHEMA,
        render: (_args: unknown, value: EvolutionSummary) => [{
          type: 'text',
          text: `self-evolution ${value.stopReason}: v${value.finalVersion}, score ${value.finalScore ?? 'n/a'}, `
            + `${value.acceptedRounds} accepted / ${value.rejectedRounds} rejected; run ${value.runId}`,
        }],
      },
      async execute(args: {
        profile_dir: string
        benchmark_dir: string
        rounds?: number
        runs_per_case?: number
        baseline_runs?: number
        target_score?: number
        adopt_external_changes?: boolean
      }, exec: { agent?: Agent; signal: AbortSignal }) {
        const parent = requireCallingAgent(exec.agent)
        return service.evolve(parent, exec.signal, {
          profileDir: service.resolveInputPath(parent, args.profile_dir),
          benchmarkDir: service.resolveInputPath(parent, args.benchmark_dir),
          rounds: positiveInteger(args.rounds, 3, 'rounds'),
          runsPerCase: positiveInteger(args.runs_per_case, 1, 'runs_per_case'),
          baselineRuns: positiveInteger(args.baseline_runs, 1, 'baseline_runs'),
          ...(score(args.target_score) === undefined ? {} : { targetScore: score(args.target_score) as number }),
          adoptExternalChanges: args.adopt_external_changes ?? false,
        })
      },
      presentCall: (args: { profile_dir?: string }) => ({
        card: 'generic',
        title: 'Evolve Agent Profile',
        kind: 'execute',
        ...(args.profile_dir === undefined ? {} : { locations: [{ path: args.profile_dir }] }),
      }),
    }))

    ctx.tools.register(defineTool({
      name: evaluateName,
      description:
        'Evaluate a managed Agent Profile on a frozen benchmark without proposing or applying changes. Runs target and '
        + 'private evaluator subagents, records scores plus DeepSeek Harness Session IDs, and appends a durable reference entry.',
      parameters: {
        profile_dir: { type: 'string', required: true, description: 'Managed profile directory.' },
        benchmark_dir: { type: 'string', required: true, description: 'Frozen benchmark directory; private rubrics should be outside the target workspace.' },
        runs_per_case: { type: 'number', description: 'Independent runs per case. Default 1.' },
        adopt_external_changes: { type: 'boolean', description: 'Adopt managed-file digest drift as a new version. Default false.' },
      },
      output: {
        schema: EVOLUTION_SUMMARY_SCHEMA,
        render: (_args: unknown, value: EvolutionSummary) => [{
          type: 'text',
          text: `evaluation completed: profile v${value.finalVersion}, score ${value.finalScore ?? 'n/a'}; run ${value.runId}`,
        }],
      },
      async execute(args: {
        profile_dir: string
        benchmark_dir: string
        runs_per_case?: number
        adopt_external_changes?: boolean
      }, exec: { agent?: Agent; signal: AbortSignal }) {
        const parent = requireCallingAgent(exec.agent)
        return service.evaluate(parent, exec.signal, {
          profileDir: service.resolveInputPath(parent, args.profile_dir),
          benchmarkDir: service.resolveInputPath(parent, args.benchmark_dir),
          runsPerCase: positiveInteger(args.runs_per_case, 1, 'runs_per_case'),
          adoptExternalChanges: args.adopt_external_changes ?? false,
        })
      },
      presentCall: (args: { profile_dir?: string }) => ({
        card: 'generic',
        title: 'Evaluate Agent Profile',
        kind: 'execute',
        ...(args.profile_dir === undefined ? {} : { locations: [{ path: args.profile_dir }] }),
      }),
    }))

    ctx.tools.register(defineTool({
      name: statusName,
      description: 'Inspect one managed Agent Profile self-evolution state: current and actual digests, drift, next version, benchmark references, and available snapshots.',
      parameters: {
        profile_dir: { type: 'string', required: true, description: 'Managed profile directory.' },
      },
      output: {
        schema: STATUS_SCHEMA,
        render: (_args: unknown, value: StatusSummary) => [{
          type: 'text',
          text: `profile v${value.currentVersion}; drifted=${value.drifted}; next=v${value.nextVersion}; snapshots=${value.snapshots.join(',') || 'none'}`,
        }],
      },
      async execute(args: { profile_dir: string }, exec: { agent?: Agent }) {
        const parent = requireCallingAgent(exec.agent)
        return service.status(service.resolveInputPath(parent, args.profile_dir))
      },
      presentCall: (args: { profile_dir?: string }) => ({
        card: 'generic',
        title: 'Inspect Evolution State',
        kind: 'read',
        ...(args.profile_dir === undefined ? {} : { locations: [{ path: args.profile_dir }] }),
      }),
    }))

    ctx.tools.register(defineTool({
      name: rollbackName,
      description:
        'Restore a managed Agent Profile to one previously verified snapshot version. The operation refuses to overwrite '
        + 'untracked concurrent changes and preserves monotonically increasing future candidate version numbers.',
      parameters: {
        profile_dir: { type: 'string', required: true, description: 'Managed profile directory.' },
        version: { type: 'number', required: true, description: 'Existing snapshot version to restore.' },
      },
      output: {
        schema: EVOLUTION_SUMMARY_SCHEMA,
        render: (_args: unknown, value: EvolutionSummary) => [{
          type: 'text',
          text: `${value.stopReason}; run ${value.runId}`,
        }],
      },
      async execute(args: { profile_dir: string; version: number }, exec: { agent?: Agent; signal: AbortSignal }) {
        const parent = requireCallingAgent(exec.agent)
        return service.rollback(
          parent,
          exec.signal,
          service.resolveInputPath(parent, args.profile_dir),
          positiveInteger(args.version, 0, 'version'),
        )
      },
      presentCall: (args: { profile_dir?: string; version?: number }) => ({
        card: 'generic',
        title: `Rollback Agent Profile${args.version === undefined ? '' : ` to v${args.version}`}`,
        kind: 'delete',
        ...(args.profile_dir === undefined ? {} : { locations: [{ path: args.profile_dir }] }),
      }),
    }))
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolution: SelfEvolutionService
  }
}

export default SelfEvolutionService
