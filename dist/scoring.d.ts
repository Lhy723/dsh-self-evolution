import type { CandidateRoundRecord, EvaluationCell, EvaluationRecord, LoadedBenchmark, PublicOptimizationEvidence } from './types.js';
export declare function assertScore(value: number, label?: string): number;
export declare function aggregateEvaluation(input: {
    kind: EvaluationRecord['kind'];
    benchmark: LoadedBenchmark;
    profileVersion: number;
    profileDigest: string;
    runsPerCase: number;
    cells: EvaluationCell[];
    startedAtMs: number;
    summary: string;
    hypothesis?: string;
    expectedBehavior?: string;
}): EvaluationRecord;
export declare function toPublicEvidence(benchmark: LoadedBenchmark, reference: EvaluationRecord, rounds: CandidateRoundRecord[]): PublicOptimizationEvidence;
export declare function collectSessionIds(evaluation: EvaluationRecord | undefined): string[];
//# sourceMappingURL=scoring.d.ts.map