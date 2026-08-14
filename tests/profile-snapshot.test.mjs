import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig } from '../dist/config.js'
import { loadProfile } from '../dist/profile.js'
import { captureSnapshot, restoreSnapshot, verifySnapshot } from '../dist/snapshot.js'
import { applyCandidate, validateCandidateProposal } from '../dist/candidate.js'

async function makeProfile(root, agents = '# Agent\nBe careful.\n') {
  await fs.mkdir(path.join(root, 'skills', 'base'), { recursive: true })
  await fs.writeFile(path.join(root, 'AGENTS.md'), agents)
  await fs.writeFile(path.join(root, 'runtime.json'), JSON.stringify({
    schemaVersion: 1,
    version: 1,
    toolFilter: { deny: ['dangerous_tool'] },
  }, null, 2))
  await fs.writeFile(path.join(root, 'skills', 'base', 'SKILL.md'), '# Base\nVerify work.\n')
}

test('candidate application is versioned and a verified snapshot restores exactly', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-evolution-profile-'))
  const profileDir = path.join(temporary, 'profile')
  const snapshots = path.join(temporary, 'snapshots')
  await makeProfile(profileDir)
  const config = resolveConfig({ stateRoot: path.join(temporary, 'state') })
  const original = await loadProfile(profileDir, config)
  const snapshot = await captureSnapshot(profileDir, snapshots, 1, config)
  assert.equal((await verifySnapshot(snapshot.path)).profileDigest, original.digest)

  const candidate = validateCandidateProposal({
    hypothesis: 'A concrete checklist will improve verification.',
    expectedBehavior: 'The agent verifies outputs before answering.',
    summary: 'Add an explicit verification skill.',
    operations: [
      { op: 'upsert', path: 'AGENTS.md', content: '# Agent\nAlways verify the result.\n' },
      { op: 'upsert', path: 'skills/verification/SKILL.md', content: '# Verification\nRun focused checks.\n' },
    ],
  }, original, config)
  const evolved = await applyCandidate(original, candidate, 2, config)
  assert.equal(evolved.runtime.version, 2)
  assert.notEqual(evolved.digest, original.digest)
  assert.match(await fs.readFile(path.join(profileDir, 'AGENTS.md'), 'utf8'), /Always verify/)

  const restoredDigest = await restoreSnapshot(snapshot.path, profileDir, evolved.digest, config)
  assert.equal(restoredDigest, original.digest)
  const restored = await loadProfile(profileDir, config)
  assert.equal(restored.runtime.version, 1)
  assert.equal(await fs.stat(path.join(profileDir, 'skills', 'verification', 'SKILL.md')).then(() => true).catch(() => false), false)

  assert.throws(() => validateCandidateProposal({
    hypothesis: 'bad',
    expectedBehavior: 'bad',
    summary: 'bad',
    operations: [{ op: 'upsert', path: '.env', content: 'SECRET=1' }],
  }, restored, config), /outside the managed mutation surface/)

  await fs.rm(temporary, { recursive: true, force: true })
})

test('candidate contamination guard rejects benchmark statement caching', async () => {
  const { assertCandidateNotBenchmarkSpecific } = await import('../dist/candidate.js')
  const candidate = {
    hypothesis: 'cache',
    expectedBehavior: 'cache',
    summary: 'cache',
    totalBytes: 100,
    operations: [{
      op: 'upsert',
      path: 'AGENTS.md',
      content: 'Solve this exact request: This is a deliberately long public benchmark statement that must not be copied into the agent profile.',
    }],
  }
  assert.throws(() => assertCandidateNotBenchmarkSpecific(candidate, {
    digest: 'abc',
    cases: [{
      id: 'long-case-id',
      statement: 'This is a deliberately long public benchmark statement that must not be copied into the agent profile.',
      rubric: 'A private rubric with enough text to trigger exact contamination checks.',
    }],
  }), /copies the full public statement/)
})
