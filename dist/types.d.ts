import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent';
export declare const SCHEMA_VERSION: 1;
export interface EvolutionPluginConfig {
    stateRoot?: string;
    subagentProvider?: string;
    maxParallelEvaluations?: number;
    minImprovement?: number;
    maxCandidateOperations?: number;
    maxCandidateBytes?: number;
    lockStaleMs?: number;
    evaluationRetries?: number;
    evaluatorRetries?: number;
    optimizerRetries?: number;
    allowBenchmarkInsideWorkspace?: boolean;
    allowModelRouteMutation?: boolean;
    managedFiles?: string[];
    excludedFiles?: string[];
    requiredFiles?: string[];
    toolPrefix?: string;
    maxDepth?: number;
    targetAgentOptions?: AgentOptions;
    evaluatorAgentOptions?: AgentOptions;
    optimizerAgentOptions?: AgentOptions;
}
export interface ResolvedEvolutionConfig {
    stateRoot: string;
    subagentProvider: string;
    maxParallelEvaluations: number;
    minImprovement: number;
    maxCandidateOperations: number;
    maxCandidateBytes: number;
    lockStaleMs: number;
    evaluationRetries: number;
    evaluatorRetries: number;
    optimizerRetries: number;
    allowBenchmarkInsideWorkspace: boolean;
    allowModelRouteMutation: boolean;
    managedFiles: string[];
    excludedFiles: string[];
    requiredFiles: string[];
    toolPrefix: string;
    maxDepth: number;
    targetAgentOptions?: AgentOptions;
    evaluatorAgentOptions?: AgentOptions;
    optimizerAgentOptions?: AgentOptions;
}
export interface ProfileRuntime {
    schemaVersion: 1;
    version: number;
    agentOptions?: AgentOptions;
    toolFilter?: {
        allow?: string[];
        deny?: string[];
    };
    metadata?: Record<string, unknown>;
}
export interface LoadedProfile {
    directory: string;
    agentsMarkdown: string;
    runtime: ProfileRuntime;
    skills: Array<{
        name: string;
        path: string;
        content: string;
    }>;
    configFiles: Array<{
        path: string;
        content: string;
    }>;
    digest: string;
    files: Array<{
        path: string;
        sha256: string;
        size: number;
    }>;
}
export interface BenchmarkManifest {
    schemaVersion: 1;
    id: string;
    title: string;
    frozen: true;
    description?: string;
    evaluatorInstructions?: string;
    cases: BenchmarkCaseManifest[];
}
export interface BenchmarkCaseManifest {
    id: string;
    statement?: string;
    statementFile?: string;
    rubricFile: string;
    weight?: number;
    tags?: string[];
}
export interface LoadedBenchmarkCase {
    id: string;
    statement: string;
    rubric: string;
    weight: number;
    tags: string[];
    statementSource: string;
    rubricSource: string;
}
export interface LoadedBenchmark {
    directory: string;
    manifest: BenchmarkManifest;
    cases: LoadedBenchmarkCase[];
    digest: string;
}
export interface CandidateOperation {
    op: 'upsert' | 'delete';
    path: string;
    content?: string;
}
export interface CandidateProposal {
    hypothesis: string;
    expectedBehavior: string;
    summary: string;
    operations: CandidateOperation[];
}
export interface ValidatedCandidate extends CandidateProposal {
    operations: CandidateOperation[];
    totalBytes: number;
}
export interface TargetRequest {
    parent: Agent;
    signal: AbortSignal;
    profile: LoadedProfile;
    benchmark: LoadedBenchmark;
    benchmarkCase: LoadedBenchmarkCase;
    runIndex: number;
    agentOptions?: AgentOptions;
    toolFilter?: {
        allow?: string[];
        deny?: string[];
    };
}
export interface TargetResult {
    sessionId: string;
    output: string;
    stopReason: string;
    durationMs: number;
}
export interface EvaluatorRequest {
    parent: Agent;
    signal: AbortSignal;
    benchmark: LoadedBenchmark;
    benchmarkCase: LoadedBenchmarkCase;
    target: TargetResult;
    profileVersion: number;
    runIndex: number;
    agentOptions?: AgentOptions;
}
export interface EvaluatorJudgement {
    valid: boolean;
    score: number;
    publicFeedback: string;
    privateNotes: string;
    behaviorTags: string[];
}
export interface EvaluatorResult extends EvaluatorJudgement {
    sessionId: string;
    stopReason: string;
    durationMs: number;
}
export interface OptimizerRequest {
    parent: Agent;
    signal: AbortSignal;
    profile: LoadedProfile;
    benchmark: LoadedBenchmark;
    evidence: PublicOptimizationEvidence;
    priorCandidates: CandidateRoundRecord[];
    agentOptions?: AgentOptions;
}
export interface OptimizerResult {
    sessionId: string;
    stopReason: string;
    durationMs: number;
    proposal: CandidateProposal;
}
export interface WorkerRuntime {
    runTarget(request: TargetRequest): Promise<TargetResult>;
    runEvaluator(request: EvaluatorRequest): Promise<EvaluatorResult>;
    runOptimizer(request: OptimizerRequest): Promise<OptimizerResult>;
}
export interface EvaluationCell {
    caseId: string;
    run: number;
    score: number;
    publicFeedback: string;
    behaviorTags: string[];
    targetOutput: string;
    targetSessionId: string;
    evaluatorSessionId: string;
    durationMs: number;
    privateArtifact: string;
}
export interface CaseEvaluation {
    caseId: string;
    score: number;
    weight: number;
    runs: EvaluationCell[];
}
export interface EvaluationRecord {
    id: string;
    kind: 'baseline' | 'candidate' | 'accepted-candidate' | 'manual-evaluation';
    benchmarkId: string;
    benchmarkDigest: string;
    profileVersion: number;
    profileDigest: string;
    runsPerCase: number;
    score: number;
    createdAt: string;
    durationMs: number;
    summary: string;
    hypothesis?: string;
    expectedBehavior?: string;
    cases: CaseEvaluation[];
}
export interface PublicOptimizationEvidence {
    reference: {
        profileVersion: number;
        score: number;
        runsPerCase: number;
        cases: Array<{
            caseId: string;
            statement: string;
            score: number;
            runs: Array<{
                run: number;
                score: number;
                publicFeedback: string;
                behaviorTags: string[];
                targetOutput: string;
                targetSessionId: string;
            }>;
        }>;
    };
    rejectedCandidates: Array<{
        version: number;
        summary: string;
        hypothesis: string;
        score?: number;
        decision: string;
    }>;
}
export interface CandidateRoundRecord {
    round: number;
    version: number;
    proposal: CandidateProposal;
    optimizerSessionId: string;
    beforeDigest: string;
    candidateDigest?: string;
    evaluation?: EvaluationRecord;
    decision: 'accepted' | 'rejected' | 'blocked';
    reason: string;
    snapshotPath: string;
}
export interface EvolutionRunRecord {
    schemaVersion: 1;
    runId: string;
    mode: 'evaluate' | 'evolve' | 'rollback';
    profilePath: string;
    benchmarkPath?: string;
    benchmarkId?: string;
    benchmarkDigest?: string;
    startedAt: string;
    finishedAt?: string;
    status: 'running' | 'completed' | 'failed' | 'aborted';
    baseline?: EvaluationRecord;
    rounds: CandidateRoundRecord[];
    finalVersion?: number;
    finalScore?: number;
    stopReason?: string;
    error?: string;
}
export interface ProfileState {
    schemaVersion: 1;
    profilePath: string;
    currentVersion: number;
    currentDigest: string;
    nextVersion: number;
    latestRunId?: string;
    updatedAt: string;
    references: Record<string, {
        benchmarkId: string;
        benchmarkDigest: string;
        profileVersion: number;
        profileDigest: string;
        evaluationId: string;
        score: number;
        runsPerCase: number;
    }>;
}
export interface SnapshotManifest {
    schemaVersion: 1;
    profilePath: string;
    version: number;
    createdAt: string;
    profileDigest: string;
    files: Array<{
        path: string;
        sha256: string;
        size: number;
    }>;
}
export interface Scoreboard {
    schemaVersion: 1;
    benchmarkId: string;
    benchmarkDigest: string;
    entries: EvaluationRecord[];
}
export interface RunEvolutionOptions {
    profileDir: string;
    benchmarkDir: string;
    rounds: number;
    runsPerCase: number;
    baselineRuns: number;
    targetScore?: number;
    adoptExternalChanges: boolean;
}
export interface EvaluateOptions {
    profileDir: string;
    benchmarkDir: string;
    runsPerCase: number;
    adoptExternalChanges: boolean;
}
export interface EvolutionSummary {
    ok: boolean;
    runId: string;
    mode: 'evaluate' | 'evolve' | 'rollback';
    profilePath: string;
    benchmarkId?: string;
    baselineScore?: number;
    finalScore?: number;
    finalVersion: number;
    acceptedRounds: number;
    rejectedRounds: number;
    stopReason: string;
    runDirectory: string;
    scoreboardPath?: string;
    sessionIds: string[];
}
export interface StatusSummary {
    profilePath: string;
    statePath: string;
    currentVersion: number;
    currentDigest: string;
    actualDigest: string;
    drifted: boolean;
    nextVersion: number;
    latestRunId?: string;
    references: ProfileState['references'];
    snapshots: number[];
}
//# sourceMappingURL=types.d.ts.map