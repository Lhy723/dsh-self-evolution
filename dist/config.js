import os from 'node:os';
import path from 'node:path';
const DEFAULT_MANAGED_FILES = [
    'AGENTS.md',
    'runtime.json',
    'skills/*/SKILL.md',
    'config/**/*.json',
    'config/**/*.md',
];
const DEFAULT_EXCLUDED_FILES = [
    '.git/**',
    'node_modules/**',
    '.env',
    '.env.*',
    '.vault*',
    '**/.vault*',
    '**/*secret*',
    '**/*credential*',
    '**/*token*',
];
const DEFAULT_REQUIRED_FILES = ['AGENTS.md', 'runtime.json'];
export function expandHome(input) {
    if (input === '~')
        return os.homedir();
    if (input.startsWith(`~${path.sep}`) || input.startsWith('~/')) {
        return path.join(os.homedir(), input.slice(2));
    }
    return input;
}
export function resolveConfig(config = {}) {
    const positiveInteger = (value, fallback, name) => {
        const resolved = value ?? fallback;
        if (!Number.isSafeInteger(resolved) || resolved < 1)
            throw new TypeError(`${name} must be a positive integer`);
        return resolved;
    };
    const nonNegative = (value, fallback, name) => {
        const resolved = value ?? fallback;
        if (!Number.isFinite(resolved) || resolved < 0)
            throw new TypeError(`${name} must be a non-negative number`);
        return resolved;
    };
    const stateRoot = path.resolve(expandHome(config.stateRoot ?? '~/.dsh/self-evolution'));
    const toolPrefix = (config.toolPrefix ?? 'evolution').trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(toolPrefix)) {
        throw new TypeError('toolPrefix must match /^[A-Za-z][A-Za-z0-9_-]*$/');
    }
    return {
        stateRoot,
        subagentProvider: config.subagentProvider ?? 'spawn',
        maxParallelEvaluations: positiveInteger(config.maxParallelEvaluations, 4, 'maxParallelEvaluations'),
        minImprovement: nonNegative(config.minImprovement, 0, 'minImprovement'),
        maxCandidateOperations: positiveInteger(config.maxCandidateOperations, 12, 'maxCandidateOperations'),
        maxCandidateBytes: positiveInteger(config.maxCandidateBytes, 256 * 1024, 'maxCandidateBytes'),
        lockStaleMs: positiveInteger(config.lockStaleMs, 30 * 60 * 1000, 'lockStaleMs'),
        evaluationRetries: nonNegative(config.evaluationRetries, 1, 'evaluationRetries'),
        evaluatorRetries: nonNegative(config.evaluatorRetries, 2, 'evaluatorRetries'),
        optimizerRetries: nonNegative(config.optimizerRetries, 1, 'optimizerRetries'),
        allowBenchmarkInsideWorkspace: config.allowBenchmarkInsideWorkspace ?? false,
        allowModelRouteMutation: config.allowModelRouteMutation ?? false,
        managedFiles: [...(config.managedFiles ?? DEFAULT_MANAGED_FILES)],
        excludedFiles: [...(config.excludedFiles ?? DEFAULT_EXCLUDED_FILES)],
        requiredFiles: [...(config.requiredFiles ?? DEFAULT_REQUIRED_FILES)],
        toolPrefix,
        maxDepth: positiveInteger(config.maxDepth, 4, 'maxDepth'),
        ...(config.targetAgentOptions === undefined ? {} : { targetAgentOptions: config.targetAgentOptions }),
        ...(config.evaluatorAgentOptions === undefined ? {} : { evaluatorAgentOptions: config.evaluatorAgentOptions }),
        ...(config.optimizerAgentOptions === undefined ? {} : { optimizerAgentOptions: config.optimizerAgentOptions }),
    };
}
//# sourceMappingURL=config.js.map