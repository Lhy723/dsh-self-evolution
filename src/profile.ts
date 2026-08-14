import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { LoadedProfile, ProfileRuntime, ResolvedEvolutionConfig } from './types.js'
import {
  canonicalJson,
  EvolutionError,
  listRegularFiles,
  matchesAny,
  normalizeRelative,
  pathExists,
  resolveExistingDirectory,
  sha256,
  writeJsonAtomic,
} from './util.js'

function assertAgentOptions(value: unknown, source: string): asserts value is AgentOptions {
  if (value === undefined) return
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EvolutionError(`${source}.agentOptions must be an object`, 'INVALID_PROFILE')
  }
  const candidate = value as Record<string, unknown>
  for (const key of ['provider', 'model'] as const) {
    if (candidate[key] !== undefined && typeof candidate[key] !== 'string') {
      throw new EvolutionError(`${source}.agentOptions.${key} must be a string`, 'INVALID_PROFILE')
    }
  }
  if (candidate.maxTokens !== undefined
    && (!Number.isSafeInteger(candidate.maxTokens) || (candidate.maxTokens as number) < 1)) {
    throw new EvolutionError(`${source}.agentOptions.maxTokens must be a positive integer`, 'INVALID_PROFILE')
  }
}

function assertToolFilter(value: unknown, source: string): asserts value is ProfileRuntime['toolFilter'] {
  if (value === undefined) return
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EvolutionError(`${source}.toolFilter must be an object`, 'INVALID_PROFILE')
  }
  const candidate = value as Record<string, unknown>
  for (const key of ['allow', 'deny'] as const) {
    const list = candidate[key]
    if (list !== undefined && (!Array.isArray(list) || list.some(item => typeof item !== 'string'))) {
      throw new EvolutionError(`${source}.toolFilter.${key} must be an array of strings`, 'INVALID_PROFILE')
    }
  }
  if (candidate.allow === undefined && candidate.deny === undefined) {
    throw new EvolutionError(`${source}.toolFilter must declare allow and/or deny`, 'INVALID_PROFILE')
  }
}

export function validateRuntime(value: unknown, source = 'runtime.json'): ProfileRuntime {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EvolutionError(`${source} must contain an object`, 'INVALID_PROFILE')
  }
  const candidate = value as Record<string, unknown>
  if (candidate.schemaVersion !== 1) throw new EvolutionError(`${source}.schemaVersion must be 1`, 'INVALID_PROFILE')
  if (!Number.isSafeInteger(candidate.version) || (candidate.version as number) < 1) {
    throw new EvolutionError(`${source}.version must be a positive integer`, 'INVALID_PROFILE')
  }
  assertAgentOptions(candidate.agentOptions, source)
  assertToolFilter(candidate.toolFilter, source)
  if (candidate.metadata !== undefined
    && (candidate.metadata === null || typeof candidate.metadata !== 'object' || Array.isArray(candidate.metadata))) {
    throw new EvolutionError(`${source}.metadata must be an object`, 'INVALID_PROFILE')
  }
  return {
    schemaVersion: 1,
    version: candidate.version as number,
    ...(candidate.agentOptions === undefined ? {} : { agentOptions: candidate.agentOptions as AgentOptions }),
    ...(candidate.toolFilter === undefined ? {} : { toolFilter: candidate.toolFilter as NonNullable<ProfileRuntime['toolFilter']> }),
    ...(candidate.metadata === undefined ? {} : { metadata: candidate.metadata as Record<string, unknown> }),
  }
}

export async function enumerateManagedFiles(
  profileDirectory: string,
  config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles'>,
): Promise<string[]> {
  const directory = await resolveExistingDirectory(profileDirectory)
  const all = await listRegularFiles(directory)
  const managed = all
    .map(normalizeRelative)
    .filter(file => matchesAny(file, config.managedFiles) && !matchesAny(file, config.excludedFiles))
    .sort()

  for (const required of config.requiredFiles) {
    const normalized = normalizeRelative(required)
    if (!managed.includes(normalized)) {
      throw new EvolutionError(`required managed profile file is missing: ${normalized}`, 'MISSING_PROFILE_FILE', {
        profileDirectory: directory,
      })
    }
  }
  return managed
}

export async function profileFileInventory(
  profileDirectory: string,
  config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles'>,
): Promise<Array<{ path: string; sha256: string; size: number }>> {
  const directory = await resolveExistingDirectory(profileDirectory)
  const files = await enumerateManagedFiles(directory, config)
  const inventory: Array<{ path: string; sha256: string; size: number }> = []
  for (const relative of files) {
    const data = await fs.readFile(path.join(directory, ...relative.split('/')))
    inventory.push({ path: relative, sha256: sha256(data), size: data.byteLength })
  }
  return inventory
}

export function digestInventory(files: Array<{ path: string; sha256: string; size: number }>): string {
  return sha256(canonicalJson(files.map(file => ({ path: file.path, sha256: file.sha256, size: file.size }))))
}

export async function computeProfileDigest(
  profileDirectory: string,
  config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles'>,
): Promise<string> {
  return digestInventory(await profileFileInventory(profileDirectory, config))
}

export async function loadProfile(
  profileDirectory: string,
  config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles'>,
): Promise<LoadedProfile> {
  const directory = await resolveExistingDirectory(profileDirectory)
  const files = await profileFileInventory(directory, config)
  const agentsPath = path.join(directory, 'AGENTS.md')
  const runtimePath = path.join(directory, 'runtime.json')
  const agentsMarkdown = await fs.readFile(agentsPath, 'utf8')
  let runtimeRaw: unknown
  try {
    runtimeRaw = JSON.parse(await fs.readFile(runtimePath, 'utf8'))
  } catch (error) {
    throw new EvolutionError(`cannot parse ${runtimePath}: ${String(error)}`, 'INVALID_PROFILE')
  }
  const runtime = validateRuntime(runtimeRaw)
  const skills: LoadedProfile['skills'] = []
  for (const file of files) {
    const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(file.path)
    if (match === null) continue
    const name = match[1]
    if (name === undefined || !/^[A-Za-z0-9_-]+$/.test(name)) {
      throw new EvolutionError(`invalid skill directory name in ${file.path}`, 'INVALID_PROFILE')
    }
    skills.push({
      name,
      path: file.path,
      content: await fs.readFile(path.join(directory, ...file.path.split('/')), 'utf8'),
    })
  }
  skills.sort((left, right) => left.name.localeCompare(right.name))
  const configFiles: LoadedProfile['configFiles'] = []
  for (const file of files) {
    if (!file.path.startsWith('config/')) continue
    configFiles.push({
      path: file.path,
      content: await fs.readFile(path.join(directory, ...file.path.split('/')), 'utf8'),
    })
  }
  configFiles.sort((left, right) => left.path.localeCompare(right.path))
  return {
    directory,
    agentsMarkdown,
    runtime,
    skills,
    configFiles,
    digest: digestInventory(files),
    files,
  }
}

export function mergeAgentOptions(...options: Array<AgentOptions | undefined>): AgentOptions | undefined {
  const result: AgentOptions = {}
  let present = false
  for (const item of options) {
    if (item === undefined) continue
    present = true
    Object.assign(result, item)
  }
  return present ? result : undefined
}

export function composeTargetPersona(profile: LoadedProfile): string {
  const skillSections = profile.skills.map(skill => [
    `## Installed Skill: ${skill.name}`,
    `Source: ${skill.path}`,
    skill.content.trim(),
  ].join('\n')).join('\n\n')
  return [
    `You are the benchmark target agent for profile version ${profile.runtime.version}.`,
    'Follow the profile instructions and installed skills below. Solve only the user task you receive.',
    'Do not discuss the benchmark, evaluation rubric, score, optimizer, or self-evolution process.',
    'Use only the tools exposed in this delegated session. Produce a useful final answer or artifact for the task.',
    '',
    '# AGENTS.md',
    profile.agentsMarkdown.trim(),
    skillSections.length === 0 ? '' : `
# Skills
${skillSections}`,
    profile.configFiles.length === 0 ? '' : `
# Profile Config
${profile.configFiles.map(file => `## ${file.path}
${file.content.trim()}`).join('\n\n')}`,
  ].filter(Boolean).join('\n')
}

export function profileAsPublicText(profile: LoadedProfile, maxBytes = 128 * 1024): string {
  const sections = [
    `## AGENTS.md\n${profile.agentsMarkdown.trim()}`,
    `## runtime.json\n${JSON.stringify(profile.runtime, null, 2)}`,
    ...profile.skills.map(skill => `## ${skill.path}\n${skill.content.trim()}`),
    ...profile.configFiles.map(file => `## ${file.path}\n${file.content.trim()}`),
  ]
  const text = sections.join('\n\n')
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new EvolutionError(`managed profile text exceeds optimizer input budget (${maxBytes} bytes)`, 'PROFILE_TOO_LARGE')
  }
  return text
}

export async function setRuntimeVersion(profileDirectory: string, version: number): Promise<void> {
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError('version must be a positive integer')
  const file = path.join(profileDirectory, 'runtime.json')
  if (!await pathExists(file)) throw new EvolutionError('runtime.json is missing', 'MISSING_PROFILE_FILE')
  const runtime = validateRuntime(JSON.parse(await fs.readFile(file, 'utf8')))
  await writeJsonAtomic(file, { ...runtime, version })
}
