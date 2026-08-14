import fs from 'node:fs/promises';
import path from 'node:path';
import { abortableSleep, assertNotAborted, EvolutionError, newId, nowIso, pathExists, readJson, sha256, writeFileAtomic, writeJsonAtomic, } from './util.js';
export function profileStoragePaths(config, profilePath) {
    const key = sha256(profilePath).slice(0, 24);
    const root = path.join(config.stateRoot, 'profiles', key);
    return {
        key,
        root,
        state: path.join(root, 'state.json'),
        lock: path.join(root, 'profile.lock'),
        snapshots: path.join(root, 'snapshots'),
        scoreboards: path.join(root, 'scoreboards'),
        runs: path.join(root, 'runs'),
    };
}
export class ProfileLock {
    file;
    token;
    released = false;
    constructor(file, token) {
        this.file = file;
        this.token = token;
    }
    async release() {
        if (this.released)
            return;
        this.released = true;
        try {
            const current = await readJson(this.file);
            if (current.token === this.token)
                await fs.rm(this.file, { force: true });
        }
        catch {
            // A missing or replaced lock is already outside this owner's control.
        }
    }
}
export async function acquireProfileLock(paths, config, signal) {
    await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
    const token = newId('lock');
    const started = Date.now();
    for (let attempt = 0; attempt < 50; attempt += 1) {
        assertNotAborted(signal);
        try {
            const handle = await fs.open(paths.lock, 'wx', 0o600);
            try {
                await handle.writeFile(`${JSON.stringify({
                    token,
                    pid: process.pid,
                    createdAt: nowIso(),
                    createdAtMs: Date.now(),
                }, null, 2)}\n`);
            }
            finally {
                await handle.close();
            }
            return new ProfileLock(paths.lock, token);
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
            try {
                const current = await readJson(paths.lock);
                if (typeof current.createdAtMs === 'number' && Date.now() - current.createdAtMs > config.lockStaleMs) {
                    await fs.rm(paths.lock, { force: true });
                    continue;
                }
            }
            catch {
                const stat = await fs.stat(paths.lock).catch(() => undefined);
                if (stat !== undefined && Date.now() - stat.mtimeMs > config.lockStaleMs) {
                    await fs.rm(paths.lock, { force: true });
                    continue;
                }
            }
            if (Date.now() - started > 5000) {
                throw new EvolutionError('another self-evolution operation holds this profile lock', 'PROFILE_LOCKED', {
                    lock: paths.lock,
                });
            }
            await abortableSleep(100, signal);
        }
    }
    throw new EvolutionError('could not acquire profile lock', 'PROFILE_LOCKED');
}
export async function loadProfileState(paths) {
    if (!await pathExists(paths.state))
        return undefined;
    const state = await readJson(paths.state);
    if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.currentVersion) || !Number.isSafeInteger(state.nextVersion)) {
        throw new EvolutionError(`invalid profile state at ${paths.state}`, 'INVALID_STATE');
    }
    return state;
}
export async function saveProfileState(paths, state) {
    await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
    await writeJsonAtomic(paths.state, { ...state, updatedAt: nowIso() });
}
export function scoreboardPath(paths, benchmarkId) {
    return path.join(paths.scoreboards, `${benchmarkId}.json`);
}
export async function loadScoreboard(paths, benchmarkId, benchmarkDigest) {
    const file = scoreboardPath(paths, benchmarkId);
    if (!await pathExists(file))
        return { schemaVersion: 1, benchmarkId, benchmarkDigest, entries: [] };
    const scoreboard = await readJson(file);
    if (scoreboard.schemaVersion !== 1 || scoreboard.benchmarkId !== benchmarkId) {
        throw new EvolutionError(`invalid scoreboard at ${file}`, 'INVALID_SCOREBOARD');
    }
    if (scoreboard.benchmarkDigest !== benchmarkDigest) {
        throw new EvolutionError(`benchmark ${benchmarkId} changed after its scoreboard was created`, 'BENCHMARK_CHANGED', { recorded: scoreboard.benchmarkDigest, actual: benchmarkDigest });
    }
    return scoreboard;
}
export async function saveScoreboard(paths, scoreboard) {
    const file = scoreboardPath(paths, scoreboard.benchmarkId);
    await fs.mkdir(paths.scoreboards, { recursive: true, mode: 0o700 });
    await writeJsonAtomic(file, scoreboard);
    const verified = await readJson(file);
    if (verified.entries.length !== scoreboard.entries.length
        || verified.entries.at(-1)?.id !== scoreboard.entries.at(-1)?.id) {
        throw new EvolutionError('scoreboard write verification failed', 'SCOREBOARD_WRITE_FAILED');
    }
    return file;
}
export async function createRunStorage(paths, mode) {
    const runId = newId(mode);
    const directory = path.join(paths.runs, runId);
    const publicDirectory = path.join(directory, 'public');
    const privateDirectory = path.join(directory, 'private');
    await fs.mkdir(publicDirectory, { recursive: true, mode: 0o700 });
    await fs.mkdir(privateDirectory, { recursive: true, mode: 0o700 });
    return {
        runId,
        directory,
        recordFile: path.join(directory, 'run.json'),
        eventsFile: path.join(directory, 'events.jsonl'),
        publicDirectory,
        privateDirectory,
    };
}
export async function saveRunRecord(storage, record) {
    await writeJsonAtomic(storage.recordFile, record);
}
export async function appendRunEvent(storage, type, data) {
    await fs.appendFile(storage.eventsFile, `${JSON.stringify({ time: nowIso(), type, data })}\n`, { mode: 0o600 });
}
export async function writePublicArtifact(storage, relativePath, value) {
    const file = path.join(storage.publicDirectory, relativePath);
    await writeJsonAtomic(file, value);
    return file;
}
export async function writePrivateArtifact(storage, relativePath, value) {
    const file = path.join(storage.privateDirectory, relativePath);
    await writeJsonAtomic(file, value);
    return file;
}
export async function latestRunId(paths) {
    if (!await pathExists(paths.runs))
        return undefined;
    const entries = await fs.readdir(paths.runs, { withFileTypes: true });
    const names = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    return names.at(-1);
}
export async function writeTextArtifact(file, content) {
    await writeFileAtomic(file, content);
}
//# sourceMappingURL=storage.js.map