import fs from 'node:fs/promises'
import path from 'node:path'
import type { ResolvedEvolutionConfig, SnapshotManifest } from './types.js'
import {
  canonicalJson,
  ConcurrentProfileChangeError,
  EvolutionError,
  isPathWithin,
  nowIso,
  pathExists,
  readJson,
  resolveExistingDirectory,
  sha256,
  writeJsonAtomic,
} from './util.js'
import { computeProfileDigest, enumerateManagedFiles, profileFileInventory } from './profile.js'

export function snapshotDirectoryForVersion(snapshotsRoot: string, version: number): string {
  return path.join(snapshotsRoot, `v${version}`)
}

export async function verifySnapshot(snapshotDirectory: string): Promise<SnapshotManifest> {
  const directory = await resolveExistingDirectory(snapshotDirectory)
  const manifest = await readJson<SnapshotManifest>(path.join(directory, 'manifest.json'))
  if (manifest.schemaVersion !== 1 || !Number.isSafeInteger(manifest.version) || manifest.version < 1) {
    throw new EvolutionError(`invalid snapshot manifest in ${directory}`, 'INVALID_SNAPSHOT')
  }
  const facts: SnapshotManifest['files'] = []
  for (const file of manifest.files) {
    const absolute = path.join(directory, 'files', ...file.path.split('/'))
    const data = await fs.readFile(absolute)
    const actual = sha256(data)
    if (actual !== file.sha256 || data.byteLength !== file.size) {
      throw new EvolutionError(`snapshot file failed verification: ${file.path}`, 'INVALID_SNAPSHOT')
    }
    facts.push({ path: file.path, sha256: actual, size: data.byteLength })
  }
  const digest = sha256(canonicalJson(facts))
  if (digest !== manifest.profileDigest) {
    throw new EvolutionError(`snapshot manifest digest mismatch in ${directory}`, 'INVALID_SNAPSHOT')
  }
  return manifest
}

export async function captureSnapshot(
  profileDirectory: string,
  snapshotsRoot: string,
  version: number,
  config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles'>,
): Promise<{ path: string; manifest: SnapshotManifest }> {
  const profile = await resolveExistingDirectory(profileDirectory)
  const target = snapshotDirectoryForVersion(snapshotsRoot, version)
  const inventory = await profileFileInventory(profile, config)
  const profileDigest = sha256(canonicalJson(inventory))
  if (await pathExists(target)) {
    const existing = await verifySnapshot(target)
    if (existing.profileDigest !== profileDigest) {
      throw new EvolutionError(
        `snapshot v${version} already exists for a different profile digest`,
        'SNAPSHOT_VERSION_CONFLICT',
        { expected: existing.profileDigest, actual: profileDigest },
      )
    }
    return { path: target, manifest: existing }
  }
  await fs.mkdir(snapshotsRoot, { recursive: true, mode: 0o700 })
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
  await fs.mkdir(path.join(temporary, 'files'), { recursive: true, mode: 0o700 })
  try {
    for (const file of inventory) {
      const source = path.join(profile, ...file.path.split('/'))
      const destination = path.join(temporary, 'files', ...file.path.split('/'))
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
      await fs.copyFile(source, destination)
      await fs.chmod(destination, 0o600).catch(() => undefined)
    }
    const manifest: SnapshotManifest = {
      schemaVersion: 1,
      profilePath: profile,
      version,
      createdAt: nowIso(),
      profileDigest,
      files: inventory,
    }
    await writeJsonAtomic(path.join(temporary, 'manifest.json'), manifest)
    await fs.rename(temporary, target)
    return { path: target, manifest }
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function removeEmptyParents(root: string, file: string): Promise<void> {
  let cursor = path.dirname(file)
  while (cursor !== root && isPathWithin(root, cursor)) {
    try {
      await fs.rmdir(cursor)
    } catch {
      return
    }
    cursor = path.dirname(cursor)
  }
}

export async function restoreSnapshot(
  snapshotDirectory: string,
  profileDirectory: string,
  expectedCurrentDigest: string,
  config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles'>,
): Promise<string> {
  const profile = await resolveExistingDirectory(profileDirectory)
  const actual = await computeProfileDigest(profile, config)
  if (actual !== expectedCurrentDigest) throw new ConcurrentProfileChangeError(expectedCurrentDigest, actual)
  const manifest = await verifySnapshot(snapshotDirectory)
  if (manifest.profilePath !== profile) {
    throw new EvolutionError('snapshot belongs to a different profile path', 'INVALID_SNAPSHOT', {
      snapshotProfile: manifest.profilePath,
      requestedProfile: profile,
    })
  }
  const currentFiles = await enumerateManagedFiles(profile, config)
  for (const relative of currentFiles) {
    const absolute = path.join(profile, ...relative.split('/'))
    await fs.rm(absolute, { force: true })
    await removeEmptyParents(profile, absolute)
  }
  for (const file of manifest.files) {
    const source = path.join(snapshotDirectory, 'files', ...file.path.split('/'))
    const destination = path.join(profile, ...file.path.split('/'))
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.copyFile(source, destination)
  }
  const restored = await computeProfileDigest(profile, config)
  if (restored !== manifest.profileDigest) {
    throw new EvolutionError('restored profile failed digest verification', 'RESTORE_FAILED', {
      expected: manifest.profileDigest,
      actual: restored,
    })
  }
  return restored
}

export async function listSnapshotVersions(snapshotsRoot: string): Promise<number[]> {
  if (!await pathExists(snapshotsRoot)) return []
  const entries = await fs.readdir(snapshotsRoot, { withFileTypes: true })
  return entries
    .filter(entry => entry.isDirectory() && /^v\d+$/.test(entry.name))
    .map(entry => Number(entry.name.slice(1)))
    .filter(Number.isSafeInteger)
    .sort((left, right) => left - right)
}
