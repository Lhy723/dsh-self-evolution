import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  EvolutionRunRecord,
  ProfileState,
  ResolvedEvolutionConfig,
  Scoreboard,
} from './types.js'
import {
  abortableSleep,
  assertNotAborted,
  EvolutionError,
  newId,
  nowIso,
  pathExists,
  readJson,
  sha256,
  writeFileAtomic,
  writeJsonAtomic,
} from './util.js'

export interface ProfileStoragePaths {
  key: string
  root: string
  state: string
  lock: string
  snapshots: string
  scoreboards: string
  runs: string
}

export function profileStoragePaths(config: Pick<ResolvedEvolutionConfig, 'stateRoot'>, profilePath: string): ProfileStoragePaths {
  const key = sha256(profilePath).slice(0, 24)
  const root = path.join(config.stateRoot, 'profiles', key)
  return {
    key,
    root,
    state: path.join(root, 'state.json'),
    lock: path.join(root, 'profile.lock'),
    snapshots: path.join(root, 'snapshots'),
    scoreboards: path.join(root, 'scoreboards'),
    runs: path.join(root, 'runs'),
  }
}

export class ProfileLock {
  private released = false

  constructor(private readonly file: string, private readonly token: string) {}

  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    try {
      const current = await readJson<{ token?: string }>(this.file)
      if (current.token === this.token) await fs.rm(this.file, { force: true })
    } catch {
      // A missing or replaced lock is already outside this owner's control.
    }
  }
}

export async function acquireProfileLock(
  paths: ProfileStoragePaths,
  config: Pick<ResolvedEvolutionConfig, 'lockStaleMs'>,
  signal?: AbortSignal,
): Promise<ProfileLock> {
  await fs.mkdir(paths.root, { recursive: true, mode: 0o700 })
  const token = newId('lock')
  const started = Date.now()
  for (let attempt = 0; attempt < 50; attempt += 1) {
    assertNotAborted(signal)
    try {
      const handle = await fs.open(paths.lock, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify({
          token,
          pid: process.pid,
          createdAt: nowIso(),
          createdAtMs: Date.now(),
        }, null, 2)}\n`)
      } finally {
        await handle.close()
      }
      return new ProfileLock(paths.lock, token)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const current = await readJson<{ createdAtMs?: number }>(paths.lock)
        if (typeof current.createdAtMs === 'number' && Date.now() - current.createdAtMs > config.lockStaleMs) {
          await fs.rm(paths.lock, { force: true })
          continue
        }
      } catch {
        const stat = await fs.stat(paths.lock).catch(() => undefined)
        if (stat !== undefined && Date.now() - stat.mtimeMs > config.lockStaleMs) {
          await fs.rm(paths.lock, { force: true })
          continue
        }
      }
      if (Date.now() - started > 5000) {
        throw new EvolutionError('another self-evolution operation holds this profile lock', 'PROFILE_LOCKED', {
          lock: paths.lock,
        })
      }
      await abortableSleep(100, signal)
    }
  }
  throw new EvolutionError('could not acquire profile lock', 'PROFILE_LOCKED')
}

export async function loadProfileState(paths: ProfileStoragePaths): Promise<ProfileState | undefined> {
  if (!await pathExists(paths.state)) return undefined
  const state = await readJson<ProfileState>(paths.state)
  if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.currentVersion) || !Number.isSafeInteger(state.nextVersion)) {
    throw new EvolutionError(`invalid profile state at ${paths.state}`, 'INVALID_STATE')
  }
  return state
}

export async function saveProfileState(paths: ProfileStoragePaths, state: ProfileState): Promise<void> {
  await fs.mkdir(paths.root, { recursive: true, mode: 0o700 })
  await writeJsonAtomic(paths.state, { ...state, updatedAt: nowIso() })
}

export function scoreboardPath(paths: ProfileStoragePaths, benchmarkId: string): string {
  return path.join(paths.scoreboards, `${benchmarkId}.json`)
}

export async function loadScoreboard(
  paths: ProfileStoragePaths,
  benchmarkId: string,
  benchmarkDigest: string,
): Promise<Scoreboard> {
  const file = scoreboardPath(paths, benchmarkId)
  if (!await pathExists(file)) return { schemaVersion: 1, benchmarkId, benchmarkDigest, entries: [] }
  const scoreboard = await readJson<Scoreboard>(file)
  if (scoreboard.schemaVersion !== 1 || scoreboard.benchmarkId !== benchmarkId) {
    throw new EvolutionError(`invalid scoreboard at ${file}`, 'INVALID_SCOREBOARD')
  }
  if (scoreboard.benchmarkDigest !== benchmarkDigest) {
    throw new EvolutionError(
      `benchmark ${benchmarkId} changed after its scoreboard was created`,
      'BENCHMARK_CHANGED',
      { recorded: scoreboard.benchmarkDigest, actual: benchmarkDigest },
    )
  }
  return scoreboard
}

export async function saveScoreboard(paths: ProfileStoragePaths, scoreboard: Scoreboard): Promise<string> {
  const file = scoreboardPath(paths, scoreboard.benchmarkId)
  await fs.mkdir(paths.scoreboards, { recursive: true, mode: 0o700 })
  await writeJsonAtomic(file, scoreboard)
  const verified = await readJson<Scoreboard>(file)
  if (verified.entries.length !== scoreboard.entries.length
    || verified.entries.at(-1)?.id !== scoreboard.entries.at(-1)?.id) {
    throw new EvolutionError('scoreboard write verification failed', 'SCOREBOARD_WRITE_FAILED')
  }
  return file
}

export interface RunStorage {
  runId: string
  directory: string
  recordFile: string
  eventsFile: string
  publicDirectory: string
  privateDirectory: string
}

export async function createRunStorage(paths: ProfileStoragePaths, mode: EvolutionRunRecord['mode']): Promise<RunStorage> {
  const runId = newId(mode)
  const directory = path.join(paths.runs, runId)
  const publicDirectory = path.join(directory, 'public')
  const privateDirectory = path.join(directory, 'private')
  await fs.mkdir(publicDirectory, { recursive: true, mode: 0o700 })
  await fs.mkdir(privateDirectory, { recursive: true, mode: 0o700 })
  return {
    runId,
    directory,
    recordFile: path.join(directory, 'run.json'),
    eventsFile: path.join(directory, 'events.jsonl'),
    publicDirectory,
    privateDirectory,
  }
}

export async function saveRunRecord(storage: RunStorage, record: EvolutionRunRecord): Promise<void> {
  await writeJsonAtomic(storage.recordFile, record)
}

export async function appendRunEvent(storage: RunStorage, type: string, data: Record<string, unknown>): Promise<void> {
  await fs.appendFile(storage.eventsFile, `${JSON.stringify({ time: nowIso(), type, data })}\n`, { mode: 0o600 })
}

export async function writePublicArtifact(storage: RunStorage, relativePath: string, value: unknown): Promise<string> {
  const file = path.join(storage.publicDirectory, relativePath)
  await writeJsonAtomic(file, value)
  return file
}

export async function writePrivateArtifact(storage: RunStorage, relativePath: string, value: unknown): Promise<string> {
  const file = path.join(storage.privateDirectory, relativePath)
  await writeJsonAtomic(file, value)
  return file
}

export async function latestRunId(paths: ProfileStoragePaths): Promise<string | undefined> {
  if (!await pathExists(paths.runs)) return undefined
  const entries = await fs.readdir(paths.runs, { withFileTypes: true })
  const names = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  return names.at(-1)
}

export async function writeTextArtifact(file: string, content: string): Promise<void> {
  await writeFileAtomic(file, content)
}
