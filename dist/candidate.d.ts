import type { CandidateProposal, LoadedProfile, ResolvedEvolutionConfig, ValidatedCandidate } from './types.js';
export declare function validateCandidateProposal(proposal: CandidateProposal, profile: LoadedProfile, config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles' | 'maxCandidateOperations' | 'maxCandidateBytes' | 'allowModelRouteMutation'>): ValidatedCandidate;
export declare function applyCandidate(profile: LoadedProfile, candidate: ValidatedCandidate, candidateVersion: number, config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles'>): Promise<LoadedProfile>;
/**
 * Reject obvious benchmark memorization or private-rubric contamination before
 * a Candidate reaches disk. This is intentionally conservative and exact-text
 * based; semantic overfitting remains an evaluation/design concern.
 */
export declare function assertCandidateNotBenchmarkSpecific(candidate: ValidatedCandidate, benchmark: {
    digest: string;
    cases: Array<{
        id: string;
        statement: string;
        rubric: string;
    }>;
}): void;
//# sourceMappingURL=candidate.d.ts.map