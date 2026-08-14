import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

export class EvolutionError extends Error {
  constructor(message: string, readonly code: string, readonly details?: Record<string, unknown>) {
    super(message)
    this.name = 'EvolutionError'
  }
}

export class ConcurrentProfileChangeError extends EvolutionError {
  constructor(expected: string, actual: string) {
    super(
      `profile changed concurrently (expected digest ${expected}, actual ${actual}); refusing to overwrite it`,
      'PROFILE_CHANGED',
      { expected, actual },
    )
    this.name = 'ConcurrentProfileChangeError'
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function newId(prefix: string): string {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID().slice(0, 8)}`
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return result
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function readJson<T>(file: string): Promise<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    throw new EvolutionError(`cannot read JSON file ${file}: ${String(error)}`, 'INVALID_JSON', { file })
  }
  return parsed as T
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writeFileAtomic(file: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`
  try {
    await fs.writeFile(temporary, content, { mode: 0o600 })
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export function normalizeRelative(input: string): string {
  if (input.includes('\0')) throw new EvolutionError('path contains a NUL byte', 'INVALID_PATH')
  const portable = input.replaceAll('\\', '/')
  if (portable.startsWith('/') || /^[A-Za-z]:\//.test(portable)) {
    throw new EvolutionError(`absolute path is not allowed: ${input}`, 'INVALID_PATH')
  }
  const normalized = path.posix.normalize(portable)
  if (normalized === '.' || normalized === '' || normalized === '..' || normalized.startsWith('../')) {
    throw new EvolutionError(`path escapes or does not identify a file: ${input}`, 'INVALID_PATH')
  }
  return normalized
}

export function isPathWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export async function resolveExistingDirectory(input: string): Promise<string> {
  const absolute = path.resolve(input)
  let real: string
  try {
    real = await fs.realpath(absolute)
  } catch (error) {
    throw new EvolutionError(`directory does not exist: ${absolute}`, 'MISSING_DIRECTORY', { cause: String(error) })
  }
  const stat = await fs.stat(real)
  if (!stat.isDirectory()) throw new EvolutionError(`not a directory: ${real}`, 'NOT_DIRECTORY')
  return real
}

export async function ensureNoSymlinkTraversal(root: string, relativePath: string): Promise<string> {
  const normalized = normalizeRelative(relativePath)
  const rootReal = await fs.realpath(root)
  let cursor = rootReal
  const segments = normalized.split('/')
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    if (segment === undefined) continue
    cursor = path.join(cursor, segment)
    try {
      const stat = await fs.lstat(cursor)
      if (stat.isSymbolicLink()) {
        throw new EvolutionError(`symlink traversal is not allowed: ${normalized}`, 'SYMLINK_PATH')
      }
      if (!stat.isDirectory()) {
        throw new EvolutionError(`parent path is not a directory: ${normalized}`, 'INVALID_PATH')
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') break
      throw error
    }
  }
  const resolved = path.resolve(rootReal, ...normalized.split('/'))
  if (!isPathWithin(rootReal, resolved)) throw new EvolutionError(`path escapes profile: ${normalized}`, 'INVALID_PATH')
  return resolved
}

function escapeRegex(text: string): string {
  return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

export function globToRegExp(glob: string): RegExp {
  const normalized = glob.replaceAll('\\', '/').replace(/^\.\//, '')
  let source = '^'
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]
    const next = normalized[index + 1]
    if (character === '*' && next === '*') {
      const after = normalized[index + 2]
      if (after === '/') {
        source += '(?:.*/)?'
        index += 2
      } else {
        source += '.*'
        index += 1
      }
    } else if (character === '*') {
      source += '[^/]*'
    } else if (character === '?') {
      source += '[^/]'
    } else {
      source += escapeRegex(character ?? '')
    }
  }
  source += '$'
  return new RegExp(source)
}

export function matchesAny(relativePath: string, patterns: readonly string[]): boolean {
  const normalized = relativePath.replaceAll('\\', '/')
  return patterns.some(pattern => globToRegExp(pattern).test(normalized))
}

export async function listRegularFiles(root: string): Promise<string[]> {
  const results: string[] = []
  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      const absolute = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new EvolutionError(`symlink is not allowed inside managed profile: ${relative}`, 'SYMLINK_PROFILE')
      }
      if (entry.isDirectory()) await visit(absolute, relative)
      else if (entry.isFile()) results.push(relative)
    }
  }
  await visit(root, '')
  return results
}

export async function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new EvolutionError('operation aborted', 'ABORTED')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new EvolutionError('operation aborted', 'ABORTED'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer.unref?.()
  })
}

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new EvolutionError('operation aborted', 'ABORTED')
}

export async function mapPool<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length)
  let cursor = 0
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      const value = values[index]
      if (value === undefined) return
      output[index] = await mapper(value, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, values.length)) }, () => worker()))
  return output
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function textFromContentBlocks(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

export function redactError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]')
}
