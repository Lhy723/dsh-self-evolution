import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type {
  EvaluatorRequest,
  LoadedBenchmarkCase,
  LoadedProfile,
  OptimizerRequest,
  ResolvedEvolutionConfig,
} from './types.js'
import { profileAsPublicText } from './profile.js'

export const EVALUATOR_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    valid: { type: 'boolean' },
    score: { type: 'number' },
    publicFeedback: { type: 'string' },
    privateNotes: { type: 'string' },
    behaviorTags: { type: 'array', items: { type: 'string' } },
  },
  required: ['valid', 'score', 'publicFeedback', 'privateNotes', 'behaviorTags'],
} satisfies ObjectJsonSchema

export const OPTIMIZER_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hypothesis: { type: 'string' },
    expectedBehavior: { type: 'string' },
    summary: { type: 'string' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          op: { type: 'string', enum: ['upsert', 'delete'] },
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['op', 'path'],
      },
    },
  },
  required: ['hypothesis', 'expectedBehavior', 'summary', 'operations'],
} satisfies ObjectJsonSchema

export function targetTaskPrompt(benchmarkCase: LoadedBenchmarkCase, profile: LoadedProfile, runIndex: number): string {
  return [
    '<benchmark_task>',
    `case_id: ${benchmarkCase.id}`,
    `profile_version: ${profile.runtime.version}`,
    `run_index: ${runIndex}`,
    '</benchmark_task>',
    '',
    benchmarkCase.statement.trim(),
  ].join('\n')
}

export function evaluatorPersona(): string {
  return [
    'You are a private, deterministic benchmark evaluator.',
    'You receive one public task statement, one private rubric, and the target agent output.',
    'Judge only against the supplied rubric. Never execute tools, inspect files, or infer hidden facts.',
    'A score is a number from 0 through 100. Set valid=false only when the supplied material cannot be scored.',
    'publicFeedback must be safe to show to the optimizer: describe observable behavior without revealing private rubric text, gold answers, hidden thresholds, or private reasoning.',
    'privateNotes may contain the full scoring rationale and is stored in a private artifact.',
    'Finish by calling the structured output tool exactly once with the required object.',
  ].join('\n')
}

export function evaluatorPrompt(request: EvaluatorRequest): string {
  const extra = request.benchmark.manifest.evaluatorInstructions?.trim()
  return [
    '<evaluation_context>',
    `benchmark_id: ${request.benchmark.manifest.id}`,
    `benchmark_digest: ${request.benchmark.digest}`,
    `case_id: ${request.benchmarkCase.id}`,
    `profile_version: ${request.profileVersion}`,
    `run_index: ${request.runIndex}`,
    `target_session_id: ${request.target.sessionId}`,
    '</evaluation_context>',
    '',
    '## Public task statement',
    request.benchmarkCase.statement.trim(),
    '',
    '## Private rubric',
    request.benchmarkCase.rubric.trim(),
    extra ? `\n## Benchmark-wide evaluator instructions\n${extra}` : '',
    '',
    '## Target agent output',
    request.target.output.trim() || '[empty output]',
    '',
    'Return the structured judgement. Do not repeat the private rubric in publicFeedback.',
  ].filter(Boolean).join('\n')
}

export function optimizerPersona(): string {
  return [
    'You are a conservative Agent Profile optimizer for DeepSeek Harness.',
    'Use only the public evidence and managed profile files in the prompt.',
    'Never ask for or infer private rubrics, gold answers, evaluator private notes, secrets, or hidden benchmark conditions.',
    'Propose one bounded, general candidate intended to improve observable behavior across the benchmark, not a case-specific answer cache.',
    'You may edit AGENTS.md, runtime.json, focused skills/*/SKILL.md files, and permitted config files.',
    'Prefer the smallest falsifiable change. Do not change benchmark files, traces, scoreboards, snapshots, or anything outside the declared mutation surface.',
    'Do not put benchmark case IDs, exact target answers, or memorized test fixtures into the profile.',
    'Finish by calling the structured output tool exactly once.',
  ].join('\n')
}

export function optimizerPrompt(request: OptimizerRequest, config: ResolvedEvolutionConfig): string {
  return [
    '<optimization_context>',
    `benchmark_id: ${request.benchmark.manifest.id}`,
    `benchmark_digest: ${request.benchmark.digest}`,
    `reference_version: ${request.evidence.reference.profileVersion}`,
    `reference_score: ${request.evidence.reference.score}`,
    '</optimization_context>',
    '',
    '## Mutation contract',
    `Allowed path patterns: ${config.managedFiles.join(', ')}`,
    `Excluded path patterns: ${config.excludedFiles.join(', ')}`,
    `Required files: ${config.requiredFiles.join(', ')}`,
    `Maximum operations: ${config.maxCandidateOperations}`,
    `Maximum total UTF-8 bytes written: ${config.maxCandidateBytes}`,
    `Provider/model route mutation allowed: ${config.allowModelRouteMutation}`,
    'The runtime.json version number is assigned by the engine; do not rely on a version you propose.',
    '',
    '## Current managed profile',
    profileAsPublicText(request.profile),
    '',
    '## Public evaluation evidence',
    JSON.stringify(request.evidence, null, 2),
    '',
    '## Prior candidate outcomes from this run',
    JSON.stringify(request.priorCandidates.map(item => ({
      version: item.version,
      summary: item.proposal.summary,
      hypothesis: item.proposal.hypothesis,
      expectedBehavior: item.proposal.expectedBehavior,
      decision: item.decision,
      reason: item.reason,
      score: item.evaluation?.score,
    })), null, 2),
    '',
    'Return one candidate. Each operation is either:',
    '- {"op":"upsert","path":"relative/path","content":"complete new file content"}',
    '- {"op":"delete","path":"relative/path"}',
  ].join('\n')
}
