import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { EvaluateOptions, EvolutionPluginConfig, EvolutionSummary, RunEvolutionOptions, StatusSummary } from './types.js';
export type Config = EvolutionPluginConfig;
export declare const Config: z<Schemastery.ObjectS<{
    stateRoot: z<string, string>;
    subagentProvider: z<string, string>;
    maxParallelEvaluations: z<number, number>;
    minImprovement: z<number, number>;
    maxCandidateOperations: z<number, number>;
    maxCandidateBytes: z<number, number>;
    lockStaleMs: z<number, number>;
    evaluationRetries: z<number, number>;
    evaluatorRetries: z<number, number>;
    optimizerRetries: z<number, number>;
    allowBenchmarkInsideWorkspace: z<boolean, boolean>;
    allowModelRouteMutation: z<boolean, boolean>;
    managedFiles: z<string[], string[]>;
    excludedFiles: z<string[], string[]>;
    requiredFiles: z<string[], string[]>;
    toolPrefix: z<string, string>;
    maxDepth: z<number, number>;
    targetAgentOptions: z<Schemastery.ObjectS<{
        provider: z<string, string>;
        model: z<string, string>;
        maxTokens: z<number, number>;
    }>, Schemastery.ObjectT<{
        provider: z<string, string>;
        model: z<string, string>;
        maxTokens: z<number, number>;
    }>>;
    evaluatorAgentOptions: z<Schemastery.ObjectS<{
        provider: z<string, string>;
        model: z<string, string>;
        maxTokens: z<number, number>;
    }>, Schemastery.ObjectT<{
        provider: z<string, string>;
        model: z<string, string>;
        maxTokens: z<number, number>;
    }>>;
    optimizerAgentOptions: z<Schemastery.ObjectS<{
        provider: z<string, string>;
        model: z<string, string>;
        maxTokens: z<number, number>;
    }>, Schemastery.ObjectT<{
        provider: z<string, string>;
        model: z<string, string>;
        maxTokens: z<number, number>;
    }>>;
}>, Schemastery.ObjectT<{
    stateRoot: z<string, string>;
    subagentProvider: z<string, string>;
    maxParallelEvaluations: z<number, number>;
    minImprovement: z<number, number>;
    maxCandidateOperations: z<number, number>;
    maxCandidateBytes: z<number, number>;
    lockStaleMs: z<number, number>;
    evaluationRetries: z<number, number>;
    evaluatorRetries: z<number, number>;
    optimizerRetries: z<number, number>;
    allowBenchmarkInsideWorkspace: z<boolean, boolean>;
    allowModelRouteMutation: z<boolean, boolean>;
    managedFiles: z<string[], string[]>;
    excludedFiles: z<string[], string[]>;
    requiredFiles: z<string[], string[]>;
    toolPrefix: z<string, string>;
    maxDepth: z<number, number>;
    targetAgentOptions: z<Schemastery.ObjectS<{
        provider: z<string, string>;
        model: z<string, string>;
        maxTokens: z<number, number>;
    }>, Schemastery.ObjectT<{
        provider: z<string, string>;
        model: z<string, string>;
        maxTokens: z<number, number>;
    }>>;
    evaluatorAgentOptions: z<Schemastery.ObjectS<{
        provider: z<string, string>;
        model: z<string, string>;
        maxTokens: z<number, number>;
    }>, Schemastery.ObjectT<{
        provider: z<string, string>;
        model: z<string, string>;
        maxTokens: z<number, number>;
    }>>;
    optimizerAgentOptions: z<Schemastery.ObjectS<{
        provider: z<string, string>;
        model: z<string, string>;
        maxTokens: z<number, number>;
    }>, Schemastery.ObjectT<{
        provider: z<string, string>;
        model: z<string, string>;
        maxTokens: z<number, number>;
    }>>;
}>>;
export declare class SelfEvolutionService extends Service {
    static inject: string[];
    static Config: z<Schemastery.ObjectS<{
        stateRoot: z<string, string>;
        subagentProvider: z<string, string>;
        maxParallelEvaluations: z<number, number>;
        minImprovement: z<number, number>;
        maxCandidateOperations: z<number, number>;
        maxCandidateBytes: z<number, number>;
        lockStaleMs: z<number, number>;
        evaluationRetries: z<number, number>;
        evaluatorRetries: z<number, number>;
        optimizerRetries: z<number, number>;
        allowBenchmarkInsideWorkspace: z<boolean, boolean>;
        allowModelRouteMutation: z<boolean, boolean>;
        managedFiles: z<string[], string[]>;
        excludedFiles: z<string[], string[]>;
        requiredFiles: z<string[], string[]>;
        toolPrefix: z<string, string>;
        maxDepth: z<number, number>;
        targetAgentOptions: z<Schemastery.ObjectS<{
            provider: z<string, string>;
            model: z<string, string>;
            maxTokens: z<number, number>;
        }>, Schemastery.ObjectT<{
            provider: z<string, string>;
            model: z<string, string>;
            maxTokens: z<number, number>;
        }>>;
        evaluatorAgentOptions: z<Schemastery.ObjectS<{
            provider: z<string, string>;
            model: z<string, string>;
            maxTokens: z<number, number>;
        }>, Schemastery.ObjectT<{
            provider: z<string, string>;
            model: z<string, string>;
            maxTokens: z<number, number>;
        }>>;
        optimizerAgentOptions: z<Schemastery.ObjectS<{
            provider: z<string, string>;
            model: z<string, string>;
            maxTokens: z<number, number>;
        }>, Schemastery.ObjectT<{
            provider: z<string, string>;
            model: z<string, string>;
            maxTokens: z<number, number>;
        }>>;
    }>, Schemastery.ObjectT<{
        stateRoot: z<string, string>;
        subagentProvider: z<string, string>;
        maxParallelEvaluations: z<number, number>;
        minImprovement: z<number, number>;
        maxCandidateOperations: z<number, number>;
        maxCandidateBytes: z<number, number>;
        lockStaleMs: z<number, number>;
        evaluationRetries: z<number, number>;
        evaluatorRetries: z<number, number>;
        optimizerRetries: z<number, number>;
        allowBenchmarkInsideWorkspace: z<boolean, boolean>;
        allowModelRouteMutation: z<boolean, boolean>;
        managedFiles: z<string[], string[]>;
        excludedFiles: z<string[], string[]>;
        requiredFiles: z<string[], string[]>;
        toolPrefix: z<string, string>;
        maxDepth: z<number, number>;
        targetAgentOptions: z<Schemastery.ObjectS<{
            provider: z<string, string>;
            model: z<string, string>;
            maxTokens: z<number, number>;
        }>, Schemastery.ObjectT<{
            provider: z<string, string>;
            model: z<string, string>;
            maxTokens: z<number, number>;
        }>>;
        evaluatorAgentOptions: z<Schemastery.ObjectS<{
            provider: z<string, string>;
            model: z<string, string>;
            maxTokens: z<number, number>;
        }>, Schemastery.ObjectT<{
            provider: z<string, string>;
            model: z<string, string>;
            maxTokens: z<number, number>;
        }>>;
        optimizerAgentOptions: z<Schemastery.ObjectS<{
            provider: z<string, string>;
            model: z<string, string>;
            maxTokens: z<number, number>;
        }>, Schemastery.ObjectT<{
            provider: z<string, string>;
            model: z<string, string>;
            maxTokens: z<number, number>;
        }>>;
    }>>;
    readonly resolvedConfig: import("./types.js").ResolvedEvolutionConfig;
    readonly toolNames: readonly string[];
    private readonly engine;
    constructor(ctx: Context, config?: Config);
    private resolveInputPath;
    evolve(parent: Agent, signal: AbortSignal, options: RunEvolutionOptions): Promise<EvolutionSummary>;
    evaluate(parent: Agent, signal: AbortSignal, options: EvaluateOptions): Promise<EvolutionSummary>;
    status(profileDir: string): Promise<StatusSummary>;
    rollback(parent: Agent, signal: AbortSignal, profileDir: string, version: number): Promise<EvolutionSummary>;
    private registerTools;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        evolution: SelfEvolutionService;
    }
}
export default SelfEvolutionService;
//# sourceMappingURL=runtime.d.ts.map