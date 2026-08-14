import type { Context } from '@deepseek-ai/cordis';
import type { EvaluatorRequest, EvaluatorResult, OptimizerRequest, OptimizerResult, ResolvedEvolutionConfig, TargetRequest, TargetResult, WorkerRuntime } from './types.js';
export declare class DshSubagentWorker implements WorkerRuntime {
    private readonly ctx;
    private readonly config;
    private readonly evolutionToolNames;
    constructor(ctx: Context, config: ResolvedEvolutionConfig, evolutionToolNames: readonly string[]);
    private executeStructured;
    runTarget(request: TargetRequest): Promise<TargetResult>;
    runEvaluator(request: EvaluatorRequest): Promise<EvaluatorResult>;
    runOptimizer(request: OptimizerRequest): Promise<OptimizerResult>;
}
//# sourceMappingURL=worker.d.ts.map