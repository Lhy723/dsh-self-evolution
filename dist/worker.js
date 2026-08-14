import { composeTargetPersona, mergeAgentOptions } from './profile.js';
import { EVALUATOR_OUTPUT_SCHEMA, evaluatorPersona, evaluatorPrompt, OPTIMIZER_OUTPUT_SCHEMA, optimizerPersona, optimizerPrompt, targetTaskPrompt, } from './prompts.js';
import { EvolutionError, textFromContentBlocks } from './util.js';
function combineToolFilter(requested, forcedDeny) {
    const deny = new Set([...(requested?.deny ?? []), ...forcedDeny]);
    const allow = requested?.allow?.filter(name => !deny.has(name));
    if (allow !== undefined)
        return { allow, ...(deny.size === 0 ? {} : { deny: [...deny] }) };
    if (deny.size > 0)
        return { deny: [...deny] };
    return undefined;
}
function ensureObject(value, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new EvolutionError(`${label} did not return a structured object`, 'INVALID_WORKER_OUTPUT');
    }
    return value;
}
function parseEvaluator(value) {
    const object = ensureObject(value, 'evaluator');
    if (typeof object.valid !== 'boolean')
        throw new EvolutionError('evaluator.valid must be boolean', 'INVALID_WORKER_OUTPUT');
    if (typeof object.score !== 'number' || !Number.isFinite(object.score) || object.score < 0 || object.score > 100) {
        throw new EvolutionError('evaluator.score must be between 0 and 100', 'INVALID_WORKER_OUTPUT');
    }
    for (const key of ['publicFeedback', 'privateNotes']) {
        if (typeof object[key] !== 'string')
            throw new EvolutionError(`evaluator.${key} must be a string`, 'INVALID_WORKER_OUTPUT');
    }
    if (!Array.isArray(object.behaviorTags) || object.behaviorTags.some(tag => typeof tag !== 'string')) {
        throw new EvolutionError('evaluator.behaviorTags must be an array of strings', 'INVALID_WORKER_OUTPUT');
    }
    return {
        valid: object.valid,
        score: object.score,
        publicFeedback: object.publicFeedback,
        privateNotes: object.privateNotes,
        behaviorTags: object.behaviorTags,
    };
}
function parseOperation(value, index) {
    const object = ensureObject(value, `optimizer.operations[${index}]`);
    if (object.op !== 'upsert' && object.op !== 'delete') {
        throw new EvolutionError(`optimizer.operations[${index}].op is invalid`, 'INVALID_WORKER_OUTPUT');
    }
    if (typeof object.path !== 'string') {
        throw new EvolutionError(`optimizer.operations[${index}].path must be a string`, 'INVALID_WORKER_OUTPUT');
    }
    if (object.op === 'upsert') {
        if (typeof object.content !== 'string') {
            throw new EvolutionError(`optimizer.operations[${index}].content must be a string`, 'INVALID_WORKER_OUTPUT');
        }
        return { op: 'upsert', path: object.path, content: object.content };
    }
    return { op: 'delete', path: object.path };
}
function parseOptimizer(value) {
    const object = ensureObject(value, 'optimizer');
    for (const key of ['hypothesis', 'expectedBehavior', 'summary']) {
        if (typeof object[key] !== 'string')
            throw new EvolutionError(`optimizer.${key} must be a string`, 'INVALID_WORKER_OUTPUT');
    }
    if (!Array.isArray(object.operations))
        throw new EvolutionError('optimizer.operations must be an array', 'INVALID_WORKER_OUTPUT');
    return {
        hypothesis: object.hypothesis,
        expectedBehavior: object.expectedBehavior,
        summary: object.summary,
        operations: object.operations.map(parseOperation),
    };
}
export class DshSubagentWorker {
    ctx;
    config;
    evolutionToolNames;
    constructor(ctx, config, evolutionToolNames) {
        this.ctx = ctx;
        this.config = config;
        this.evolutionToolNames = evolutionToolNames;
    }
    async executeStructured(input) {
        const startedAt = Date.now();
        const run = await this.ctx.subagents.start(this.config.subagentProvider, {
            label: input.label,
            parent: input.parent,
            signal: input.signal,
            prompt: [{ type: 'text', text: input.prompt }],
            persona: input.persona,
            outputSchema: input.outputSchema,
            toolFilter: { allow: [] },
            maxDepth: this.config.maxDepth,
            ...(input.agentOptions === undefined ? {} : { agentOptions: input.agentOptions }),
        });
        try {
            const result = await run.result;
            if (result.stopReason !== 'completed') {
                throw new EvolutionError(`${input.label} subagent ended with ${result.stopReason}: ${textFromContentBlocks(result.output)}`, 'WORKER_FAILED', { sessionId: String(run.id), stopReason: result.stopReason });
            }
            if (result.structured === undefined) {
                throw new EvolutionError(`${input.label} did not produce structured output`, 'INVALID_WORKER_OUTPUT', {
                    sessionId: String(run.id),
                });
            }
            return {
                sessionId: String(run.id),
                stopReason: result.stopReason,
                durationMs: Date.now() - startedAt,
                structured: result.structured,
            };
        }
        finally {
            await run.dispose();
        }
    }
    async runTarget(request) {
        const startedAt = Date.now();
        const toolFilter = combineToolFilter(request.toolFilter, this.evolutionToolNames);
        const agentOptions = mergeAgentOptions(request.parent.options, request.profile.runtime.agentOptions, this.config.targetAgentOptions, request.agentOptions);
        const run = await this.ctx.subagents.start(this.config.subagentProvider, {
            label: `benchmark ${request.benchmarkCase.id} run ${request.runIndex}`,
            parent: request.parent,
            signal: request.signal,
            prompt: [{ type: 'text', text: targetTaskPrompt(request.benchmarkCase, request.profile, request.runIndex) }],
            persona: composeTargetPersona(request.profile),
            maxDepth: this.config.maxDepth,
            ...(toolFilter === undefined ? {} : { toolFilter }),
            ...(agentOptions === undefined ? {} : { agentOptions }),
        });
        try {
            const result = await run.result;
            const output = textFromContentBlocks(result.output);
            if (result.stopReason !== 'completed') {
                throw new EvolutionError(`target agent ended with ${result.stopReason}${output ? `: ${output}` : ''}`, 'TARGET_FAILED', { sessionId: String(run.id), stopReason: result.stopReason });
            }
            return {
                sessionId: String(run.id),
                output,
                stopReason: result.stopReason,
                durationMs: Date.now() - startedAt,
            };
        }
        finally {
            await run.dispose();
        }
    }
    async runEvaluator(request) {
        const executed = await this.executeStructured({
            parent: request.parent,
            signal: request.signal,
            label: `evaluate ${request.benchmarkCase.id} run ${request.runIndex}`,
            persona: evaluatorPersona(),
            prompt: evaluatorPrompt(request),
            outputSchema: EVALUATOR_OUTPUT_SCHEMA,
            ...mergeAgentOptions(request.parent.options, this.config.evaluatorAgentOptions, request.agentOptions) === undefined ? {} : { agentOptions: mergeAgentOptions(request.parent.options, this.config.evaluatorAgentOptions, request.agentOptions) },
        });
        const judgement = parseEvaluator(executed.structured);
        return { ...judgement, sessionId: executed.sessionId, stopReason: executed.stopReason, durationMs: executed.durationMs };
    }
    async runOptimizer(request) {
        const executed = await this.executeStructured({
            parent: request.parent,
            signal: request.signal,
            label: `optimize profile v${request.profile.runtime.version}`,
            persona: optimizerPersona(),
            prompt: optimizerPrompt(request, this.config),
            outputSchema: OPTIMIZER_OUTPUT_SCHEMA,
            ...mergeAgentOptions(request.parent.options, this.config.optimizerAgentOptions, request.agentOptions) === undefined ? {} : { agentOptions: mergeAgentOptions(request.parent.options, this.config.optimizerAgentOptions, request.agentOptions) },
        });
        return {
            sessionId: executed.sessionId,
            stopReason: executed.stopReason,
            durationMs: executed.durationMs,
            proposal: parseOptimizer(executed.structured),
        };
    }
}
//# sourceMappingURL=worker.js.map