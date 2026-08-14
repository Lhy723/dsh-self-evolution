import fs from 'node:fs/promises';
import path from 'node:path';
import { ConcurrentProfileChangeError, ensureNoSymlinkTraversal, EvolutionError, matchesAny, normalizeRelative, pathExists, writeFileAtomic, } from './util.js';
import { computeProfileDigest, loadProfile, setRuntimeVersion, validateRuntime } from './profile.js';
function validateOperation(value, index) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new EvolutionError(`candidate operation ${index} must be an object`, 'INVALID_CANDIDATE');
    }
    const candidate = value;
    if (candidate.op !== 'upsert' && candidate.op !== 'delete') {
        throw new EvolutionError(`candidate operation ${index}.op must be upsert or delete`, 'INVALID_CANDIDATE');
    }
    if (typeof candidate.path !== 'string') {
        throw new EvolutionError(`candidate operation ${index}.path must be a string`, 'INVALID_CANDIDATE');
    }
    const relative = normalizeRelative(candidate.path);
    if (candidate.op === 'upsert') {
        if (typeof candidate.content !== 'string') {
            throw new EvolutionError(`candidate upsert ${relative} needs string content`, 'INVALID_CANDIDATE');
        }
        return { op: 'upsert', path: relative, content: candidate.content };
    }
    if (candidate.content !== undefined) {
        throw new EvolutionError(`candidate delete ${relative} must not include content`, 'INVALID_CANDIDATE');
    }
    return { op: 'delete', path: relative };
}
export function validateCandidateProposal(proposal, profile, config) {
    for (const field of ['hypothesis', 'expectedBehavior', 'summary']) {
        if (typeof proposal[field] !== 'string' || proposal[field].trim().length === 0) {
            throw new EvolutionError(`candidate ${field} must be a non-empty string`, 'INVALID_CANDIDATE');
        }
    }
    if (!Array.isArray(proposal.operations) || proposal.operations.length === 0) {
        throw new EvolutionError('candidate must contain at least one operation', 'INVALID_CANDIDATE');
    }
    if (proposal.operations.length > config.maxCandidateOperations) {
        throw new EvolutionError(`candidate exceeds ${config.maxCandidateOperations} operations`, 'INVALID_CANDIDATE');
    }
    const operations = proposal.operations.map(validateOperation);
    const seen = new Set();
    let totalBytes = 0;
    for (const operation of operations) {
        if (seen.has(operation.path))
            throw new EvolutionError(`candidate repeats path ${operation.path}`, 'INVALID_CANDIDATE');
        seen.add(operation.path);
        if (!matchesAny(operation.path, config.managedFiles) || matchesAny(operation.path, config.excludedFiles)) {
            throw new EvolutionError(`candidate path is outside the managed mutation surface: ${operation.path}`, 'INVALID_CANDIDATE');
        }
        if (operation.op === 'delete' && config.requiredFiles.map(normalizeRelative).includes(operation.path)) {
            throw new EvolutionError(`candidate cannot delete required file ${operation.path}`, 'INVALID_CANDIDATE');
        }
        if (operation.op === 'upsert')
            totalBytes += Buffer.byteLength(operation.content ?? '', 'utf8');
    }
    if (totalBytes > config.maxCandidateBytes) {
        throw new EvolutionError(`candidate writes ${totalBytes} bytes, exceeding ${config.maxCandidateBytes}`, 'INVALID_CANDIDATE');
    }
    const runtimeOperation = operations.find(operation => operation.path === 'runtime.json');
    if (runtimeOperation?.op === 'delete')
        throw new EvolutionError('runtime.json cannot be deleted', 'INVALID_CANDIDATE');
    if (runtimeOperation?.op === 'upsert') {
        let proposedRuntime;
        try {
            proposedRuntime = validateRuntime(JSON.parse(runtimeOperation.content ?? ''), 'candidate runtime.json');
        }
        catch (error) {
            if (error instanceof EvolutionError)
                throw error;
            throw new EvolutionError(`candidate runtime.json is not valid JSON: ${String(error)}`, 'INVALID_CANDIDATE');
        }
        if (!config.allowModelRouteMutation) {
            const before = profile.runtime.agentOptions;
            const after = proposedRuntime.agentOptions;
            if (before?.provider !== after?.provider || before?.model !== after?.model) {
                throw new EvolutionError('candidate cannot change runtime agentOptions.provider/model unless allowModelRouteMutation is enabled', 'INVALID_CANDIDATE');
            }
        }
    }
    return {
        hypothesis: proposal.hypothesis.trim(),
        expectedBehavior: proposal.expectedBehavior.trim(),
        summary: proposal.summary.trim(),
        operations,
        totalBytes,
    };
}
async function rollbackPartial(profileDirectory, originals) {
    const conflicts = [];
    for (const original of [...originals].reverse()) {
        const absolute = path.join(profileDirectory, ...original.path.split('/'));
        if (original.writtenContent !== undefined) {
            const exists = await pathExists(absolute);
            if (!exists) {
                if (original.existed && original.content !== undefined)
                    await writeFileAtomic(absolute, original.content);
                continue;
            }
            const current = await fs.readFile(absolute);
            if (!current.equals(original.writtenContent)) {
                conflicts.push(original.path);
                continue;
            }
            if (original.existed && original.content !== undefined)
                await writeFileAtomic(absolute, original.content);
            else
                await fs.rm(absolute, { force: true });
        }
        else if (original.deleted) {
            if (await pathExists(absolute)) {
                conflicts.push(original.path);
                continue;
            }
            if (original.existed && original.content !== undefined)
                await writeFileAtomic(absolute, original.content);
        }
    }
    if (conflicts.length > 0) {
        throw new EvolutionError(`partial candidate rollback detected concurrent changes in: ${conflicts.join(', ')}`, 'PROFILE_CHANGED', { conflicts });
    }
}
export async function applyCandidate(profile, candidate, candidateVersion, config) {
    const actual = await computeProfileDigest(profile.directory, config);
    if (actual !== profile.digest)
        throw new ConcurrentProfileChangeError(profile.digest, actual);
    const originals = [];
    try {
        for (const operation of candidate.operations) {
            const absolute = await ensureNoSymlinkTraversal(profile.directory, operation.path);
            const existed = await pathExists(absolute);
            const content = existed ? await fs.readFile(absolute) : undefined;
            const original = {
                path: operation.path,
                existed,
                ...(content === undefined ? {} : { content }),
            };
            originals.push(original);
            if (operation.op === 'upsert') {
                const written = Buffer.from(operation.content ?? '', 'utf8');
                await writeFileAtomic(absolute, written);
                original.writtenContent = written;
            }
            else {
                await fs.rm(absolute, { force: true });
                original.deleted = true;
            }
        }
        let runtimeOriginal = originals.find(item => item.path === 'runtime.json');
        if (runtimeOriginal === undefined) {
            const runtimePath = path.join(profile.directory, 'runtime.json');
            runtimeOriginal = {
                path: 'runtime.json',
                existed: true,
                content: await fs.readFile(runtimePath),
            };
            originals.push(runtimeOriginal);
        }
        await setRuntimeVersion(profile.directory, candidateVersion);
        runtimeOriginal.writtenContent = await fs.readFile(path.join(profile.directory, 'runtime.json'));
        return await loadProfile(profile.directory, config);
    }
    catch (error) {
        await rollbackPartial(profile.directory, originals);
        throw error;
    }
}
/**
 * Reject obvious benchmark memorization or private-rubric contamination before
 * a Candidate reaches disk. This is intentionally conservative and exact-text
 * based; semantic overfitting remains an evaluation/design concern.
 */
export function assertCandidateNotBenchmarkSpecific(candidate, benchmark) {
    const written = candidate.operations
        .filter((operation) => operation.op === 'upsert' && typeof operation.content === 'string')
        .map(operation => operation.content)
        .join('\n');
    if (written.includes(benchmark.digest)) {
        throw new EvolutionError('candidate embeds the benchmark digest', 'BENCHMARK_OVERFIT');
    }
    for (const benchmarkCase of benchmark.cases) {
        const statement = benchmarkCase.statement.trim();
        const rubric = benchmarkCase.rubric.trim();
        if (statement.length >= 40 && written.includes(statement)) {
            throw new EvolutionError(`candidate copies the full public statement for case ${benchmarkCase.id}`, 'BENCHMARK_OVERFIT');
        }
        if (rubric.length >= 20 && written.includes(rubric)) {
            throw new EvolutionError(`candidate contains private rubric text for case ${benchmarkCase.id}`, 'BENCHMARK_CONTAMINATION');
        }
        if (benchmarkCase.id.length >= 8 && written.includes(`case_id: ${benchmarkCase.id}`)) {
            throw new EvolutionError(`candidate contains a benchmark case identifier (${benchmarkCase.id})`, 'BENCHMARK_OVERFIT');
        }
    }
}
//# sourceMappingURL=candidate.js.map