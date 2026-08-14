import type { EvaluatorRequest, LoadedBenchmarkCase, LoadedProfile, OptimizerRequest, ResolvedEvolutionConfig } from './types.js';
export declare const EVALUATOR_OUTPUT_SCHEMA: {
    type: "object";
    additionalProperties: false;
    properties: {
        valid: {
            type: "boolean";
        };
        score: {
            type: "number";
        };
        publicFeedback: {
            type: "string";
        };
        privateNotes: {
            type: "string";
        };
        behaviorTags: {
            type: "array";
            items: {
                type: "string";
            };
        };
    };
    required: string[];
};
export declare const OPTIMIZER_OUTPUT_SCHEMA: {
    type: "object";
    additionalProperties: false;
    properties: {
        hypothesis: {
            type: "string";
        };
        expectedBehavior: {
            type: "string";
        };
        summary: {
            type: "string";
        };
        operations: {
            type: "array";
            items: {
                type: "object";
                additionalProperties: false;
                properties: {
                    op: {
                        type: "string";
                        enum: string[];
                    };
                    path: {
                        type: "string";
                    };
                    content: {
                        type: "string";
                    };
                };
                required: string[];
            };
        };
    };
    required: string[];
};
export declare function targetTaskPrompt(benchmarkCase: LoadedBenchmarkCase, profile: LoadedProfile, runIndex: number): string;
export declare function evaluatorPersona(): string;
export declare function evaluatorPrompt(request: EvaluatorRequest): string;
export declare function optimizerPersona(): string;
export declare function optimizerPrompt(request: OptimizerRequest, config: ResolvedEvolutionConfig): string;
//# sourceMappingURL=prompts.d.ts.map