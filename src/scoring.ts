import type {
  CaseEvaluation,
  CandidateRoundRecord,
  EvaluationCell,
  EvaluationRecord,
  LoadedBenchmark,
  PublicOptimizationEvidence,
} from './types.js'
import { EvolutionError, newId, nowIso, round } from './util.js'

export function assertScore(value: number, label = 'score'): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new EvolutionError(`${label} must be a finite number between 0 and 100`, 'INVALID_SCORE')
  }
  return round(value, 2)
}

export function aggregateEvaluation(input: {
  kind: EvaluationRecord['kind']
  benchmark: LoadedBenchmark
  profileVersion: number
  profileDigest: string
  runsPerCase: number
  cells: EvaluationCell[]
  startedAtMs: number
  summary: string
  hypothesis?: string
  expectedBehavior?: string
}): EvaluationRecord {
  const cases: CaseEvaluation[] = input.benchmark.cases.map(benchmarkCase => {
    const runs = input.cells
      .filter(cell => cell.caseId === benchmarkCase.id)
      .sort((left, right) => left.run - right.run)
    if (runs.length !== input.runsPerCase) {
      throw new EvolutionError(
        `case ${benchmarkCase.id} has ${runs.length} runs; expected ${input.runsPerCase}`,
        'INCOMPLETE_EVALUATION',
      )
    }
    const runNumbers = new Set(runs.map(run => run.run))
    if (runNumbers.size !== input.runsPerCase
      || [...runNumbers].some(run => !Number.isSafeInteger(run) || run < 1 || run > input.runsPerCase)) {
      throw new EvolutionError(`case ${benchmarkCase.id} run indices are incomplete or duplicated`, 'INCOMPLETE_EVALUATION')
    }
    return {
      caseId: benchmarkCase.id,
      score: round(runs.reduce((sum, run) => sum + assertScore(run.score), 0) / runs.length, 2),
      weight: benchmarkCase.weight,
      runs,
    }
  })
  const weightTotal = cases.reduce((sum, item) => sum + item.weight, 0)
  const score = round(cases.reduce((sum, item) => sum + item.score * item.weight, 0) / weightTotal, 2)
  return {
    id: newId('evaluation'),
    kind: input.kind,
    benchmarkId: input.benchmark.manifest.id,
    benchmarkDigest: input.benchmark.digest,
    profileVersion: input.profileVersion,
    profileDigest: input.profileDigest,
    runsPerCase: input.runsPerCase,
    score,
    createdAt: nowIso(),
    durationMs: Math.max(0, Date.now() - input.startedAtMs),
    summary: input.summary,
    ...(input.hypothesis === undefined ? {} : { hypothesis: input.hypothesis }),
    ...(input.expectedBehavior === undefined ? {} : { expectedBehavior: input.expectedBehavior }),
    cases,
  }
}

export function toPublicEvidence(
  benchmark: LoadedBenchmark,
  reference: EvaluationRecord,
  rounds: CandidateRoundRecord[],
): PublicOptimizationEvidence {
  return {
    reference: {
      profileVersion: reference.profileVersion,
      score: reference.score,
      runsPerCase: reference.runsPerCase,
      cases: reference.cases.map(caseEvaluation => {
        const benchmarkCase = benchmark.cases.find(item => item.id === caseEvaluation.caseId)
        if (benchmarkCase === undefined) {
          throw new EvolutionError(`evaluation refers to unknown case ${caseEvaluation.caseId}`, 'INVALID_EVALUATION')
        }
        return {
          caseId: caseEvaluation.caseId,
          statement: benchmarkCase.statement,
          score: caseEvaluation.score,
          runs: caseEvaluation.runs.map(run => ({
            run: run.run,
            score: run.score,
            publicFeedback: run.publicFeedback,
            behaviorTags: [...run.behaviorTags],
            targetOutput: run.targetOutput,
            targetSessionId: run.targetSessionId,
          })),
        }
      }),
    },
    rejectedCandidates: rounds
      .filter(roundRecord => roundRecord.decision !== 'accepted')
      .map(roundRecord => ({
        version: roundRecord.version,
        summary: roundRecord.proposal.summary,
        hypothesis: roundRecord.proposal.hypothesis,
        ...(roundRecord.evaluation === undefined ? {} : { score: roundRecord.evaluation.score }),
        decision: roundRecord.reason,
      })),
  }
}

export function collectSessionIds(evaluation: EvaluationRecord | undefined): string[] {
  if (evaluation === undefined) return []
  const ids: string[] = []
  for (const caseEvaluation of evaluation.cases) {
    for (const run of caseEvaluation.runs) {
      ids.push(run.targetSessionId, run.evaluatorSessionId)
    }
  }
  return ids
}
