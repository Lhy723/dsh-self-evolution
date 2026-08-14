import type { Agent } from '@deepseek-ai/dsh-agent';
import type { EvaluateOptions, EvolutionSummary, ResolvedEvolutionConfig, RunEvolutionOptions, StatusSummary, WorkerRuntime } from './types.js';
export interface EvolutionLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
export declare class EvolutionEngine {
    private readonly config;
    private readonly worker;
    private readonly logger;
    constructor(config: ResolvedEvolutionConfig, worker: WorkerRuntime, logger: EvolutionLogger);
    private workspaceOf;
    private ensureState;
    private verifyBenchmarkUnchanged;
    private runEvaluationCell;
    private evaluateProfile;
    private referenceFor;
    private proposeCandidate;
    private initializeRunRecord;
    evaluate(parent: Agent, signal: AbortSignal, options: EvaluateOptions): Promise<EvolutionSummary>;
    evolve(parent: Agent, signal: AbortSignal, options: RunEvolutionOptions): Promise<EvolutionSummary>;
    rollback(parent: Agent, signal: AbortSignal, profileDir: string, version: number): Promise<EvolutionSummary>;
    status(profileDir: string): Promise<StatusSummary>;
}
//# sourceMappingURL=engine.d.ts.map