import test from 'node:test'
import assert from 'node:assert/strict'
import { globToRegExp, matchesAny, normalizeRelative } from '../dist/util.js'

test('glob matcher supports *, ** and exact managed paths', () => {
  assert.equal(globToRegExp('skills/*/SKILL.md').test('skills/research/SKILL.md'), true)
  assert.equal(globToRegExp('skills/*/SKILL.md').test('skills/a/ref/SKILL.md'), false)
  assert.equal(globToRegExp('config/**/*.json').test('config/runtime.json'), true)
  assert.equal(globToRegExp('config/**/*.json').test('config/nested/runtime.json'), true)
  assert.equal(matchesAny('AGENTS.md', ['AGENTS.md']), true)
  assert.equal(matchesAny('.env.local', ['.env.*']), true)
})

test('managed relative paths reject traversal and absolute paths', () => {
  assert.equal(normalizeRelative('skills/demo/SKILL.md'), 'skills/demo/SKILL.md')
  assert.throws(() => normalizeRelative('../private/rubric.md'), /escapes/)
  assert.throws(() => normalizeRelative('/etc/passwd'), /absolute/)
  assert.throws(() => normalizeRelative('C:\\Windows\\system.ini'), /absolute/)
})
