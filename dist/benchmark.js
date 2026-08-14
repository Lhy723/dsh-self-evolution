import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, EvolutionError, isPathWithin, normalizeRelative, resolveExistingDirectory, sha256, } from './util.js';
function assertString(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new EvolutionError(`${label} must be a non-empty string`, 'INVALID_BENCHMARK');
    }
}
function validateCase(value, index) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new EvolutionError(`benchmark case ${index} must be an object`, 'INVALID_BENCHMARK');
    }
    const candidate = value;
    assertString(candidate.id, `cases[${index}].id`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(candidate.id)) {
        throw new EvolutionError(`cases[${index}].id contains unsupported characters`, 'INVALID_BENCHMARK');
    }
    const hasStatement = typeof candidate.statement === 'string' && candidate.statement.trim().length > 0;
    const hasStatementFile = typeof candidate.statementFile === 'string' && candidate.statementFile.trim().length > 0;
    if (hasStatement === hasStatementFile) {
        throw new EvolutionError(`case ${candidate.id} must define exactly one of statement or statementFile`, 'INVALID_BENCHMARK');
    }
    assertString(candidate.rubricFile, `case ${candidate.id}.rubricFile`);
    if (candidate.weight !== undefined && (typeof candidate.weight !== 'number' || !Number.isFinite(candidate.weight) || candidate.weight <= 0)) {
        throw new EvolutionError(`case ${candidate.id}.weight must be positive`, 'INVALID_BENCHMARK');
    }
    if (candidate.tags !== undefined && (!Array.isArray(candidate.tags) || candidate.tags.some(tag => typeof tag !== 'string'))) {
        throw new EvolutionError(`case ${candidate.id}.tags must be an array of strings`, 'INVALID_BENCHMARK');
    }
    return {
        id: candidate.id,
        ...(hasStatement ? { statement: candidate.statement } : { statementFile: candidate.statementFile }),
        rubricFile: candidate.rubricFile,
        ...(candidate.weight === undefined ? {} : { weight: candidate.weight }),
        ...(candidate.tags === undefined ? {} : { tags: candidate.tags }),
    };
}
export function validateBenchmarkManifest(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new EvolutionError('benchmark.json must contain an object', 'INVALID_BENCHMARK');
    }
    const candidate = value;
    if (candidate.schemaVersion !== 1)
        throw new EvolutionError('benchmark schemaVersion must be 1', 'INVALID_BENCHMARK');
    assertString(candidate.id, 'benchmark.id');
    assertString(candidate.title, 'benchmark.title');
    if (candidate.frozen !== true) {
        throw new EvolutionError('benchmark must declare frozen: true before it can drive optimization', 'BENCHMARK_NOT_FROZEN');
    }
    if (!Array.isArray(candidate.cases) || candidate.cases.length === 0) {
        throw new EvolutionError('benchmark.cases must be a non-empty array', 'INVALID_BENCHMARK');
    }
    const cases = candidate.cases.map(validateCase);
    const duplicate = cases.find((item, index) => cases.findIndex(other => other.id === item.id) !== index);
    if (duplicate !== undefined)
        throw new EvolutionError(`duplicate benchmark case id: ${duplicate.id}`, 'INVALID_BENCHMARK');
    if (candidate.description !== undefined && typeof candidate.description !== 'string') {
        throw new EvolutionError('benchmark.description must be a string', 'INVALID_BENCHMARK');
    }
    if (candidate.evaluatorInstructions !== undefined && typeof candidate.evaluatorInstructions !== 'string') {
        throw new EvolutionError('benchmark.evaluatorInstructions must be a string', 'INVALID_BENCHMARK');
    }
    return {
        schemaVersion: 1,
        id: candidate.id,
        title: candidate.title,
        frozen: true,
        ...(candidate.description === undefined ? {} : { description: candidate.description }),
        ...(candidate.evaluatorInstructions === undefined ? {} : { evaluatorInstructions: candidate.evaluatorInstructions }),
        cases,
    };
}
async function readContainedFile(directory, requested, label) {
    const relative = normalizeRelative(requested);
    const absolute = path.resolve(directory, ...relative.split('/'));
    if (!isPathWithin(directory, absolute))
        throw new EvolutionError(`${label} escapes benchmark directory`, 'INVALID_BENCHMARK');
    let real;
    try {
        real = await fs.realpath(absolute);
    }
    catch (error) {
        throw new EvolutionError(`${label} does not exist: ${relative}`, 'INVALID_BENCHMARK', { cause: String(error) });
    }
    if (!isPathWithin(directory, real))
        throw new EvolutionError(`${label} resolves outside benchmark directory`, 'INVALID_BENCHMARK');
    const stat = await fs.lstat(real);
    if (!stat.isFile() || stat.isSymbolicLink())
        throw new EvolutionError(`${label} must be a regular file`, 'INVALID_BENCHMARK');
    return { path: relative, content: await fs.readFile(real, 'utf8') };
}
export async function loadBenchmark(benchmarkDirectory, options) {
    const directory = await resolveExistingDirectory(benchmarkDirectory);
    if (options.workspace !== undefined && !options.allowInsideWorkspace) {
        const workspace = await resolveExistingDirectory(options.workspace);
        if (isPathWithin(workspace, directory)) {
            throw new EvolutionError('benchmark directory is inside the target workspace; move private rubrics outside the workspace or explicitly enable allowBenchmarkInsideWorkspace', 'BENCHMARK_EXPOSED', { benchmarkDirectory: directory, workspace });
        }
    }
    let raw;
    try {
        raw = JSON.parse(await fs.readFile(path.join(directory, 'benchmark.json'), 'utf8'));
    }
    catch (error) {
        throw new EvolutionError(`cannot read benchmark.json: ${String(error)}`, 'INVALID_BENCHMARK');
    }
    const manifest = validateBenchmarkManifest(raw);
    const cases = [];
    const digestFacts = [{ manifest }];
    for (const item of manifest.cases) {
        let statement;
        let statementSource;
        if (item.statement !== undefined) {
            statement = item.statement;
            statementSource = 'inline';
        }
        else {
            const loaded = await readContainedFile(directory, item.statementFile, `case ${item.id} statementFile`);
            statement = loaded.content;
            statementSource = loaded.path;
        }
        const rubric = await readContainedFile(directory, item.rubricFile, `case ${item.id} rubricFile`);
        if (statement.trim().length === 0)
            throw new EvolutionError(`case ${item.id} statement is empty`, 'INVALID_BENCHMARK');
        if (rubric.content.trim().length === 0)
            throw new EvolutionError(`case ${item.id} rubric is empty`, 'INVALID_BENCHMARK');
        const loadedCase = {
            id: item.id,
            statement,
            rubric: rubric.content,
            weight: item.weight ?? 1,
            tags: [...(item.tags ?? [])],
            statementSource,
            rubricSource: rubric.path,
        };
        cases.push(loadedCase);
        digestFacts.push({
            id: loadedCase.id,
            statementSource,
            statement: sha256(statement),
            rubricSource: rubric.path,
            rubric: sha256(rubric.content),
            weight: loadedCase.weight,
            tags: loadedCase.tags,
        });
    }
    return { directory, manifest, cases, digest: sha256(canonicalJson(digestFacts)) };
}
//# sourceMappingURL=benchmark.js.map