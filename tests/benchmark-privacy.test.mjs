import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadBenchmark } from '../dist/benchmark.js'
import { optimizerPrompt } from '../dist/prompts.js'
import { resolveConfig } from '../dist/config.js'
import { loadProfile } from '../dist/profile.js'

async function createBenchmark(directory, secret = 'PRIVATE_GOLD_NEVER_LEAK') {
  await fs.mkdir(path.join(directory, 'public'), { recursive: true })
  await fs.mkdir(path.join(directory, 'private'), { recursive: true })
  await fs.writeFile(path.join(directory, 'benchmark.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'demo',
    title: 'Demo',
    frozen: true,
    cases: [{ id: 'case-a', statementFile: 'public/case-a.md', rubricFile: 'private/case-a.md' }],
  }, null, 2))
  await fs.writeFile(path.join(directory, 'public', 'case-a.md'), 'Produce a concise answer.')
  await fs.writeFile(path.join(directory, 'private', 'case-a.md'), `${secret}: award 100 only for the hidden standard.`)
}

async function createProfile(directory) {
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'AGENTS.md'), '# Agent\nBe concise.\n')
  await fs.writeFile(path.join(directory, 'runtime.json'), JSON.stringify({ schemaVersion: 1, version: 1 }, null, 2))
}

test('benchmark digest changes with private rubric and optimizer prompt excludes it', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-evolution-benchmark-'))
  const benchmarkDir = path.join(temporary, 'benchmark')
  const workspace = path.join(temporary, 'workspace')
  const profileDir = path.join(workspace, 'profile')
  await fs.mkdir(workspace, { recursive: true })
  await createBenchmark(benchmarkDir)
  await createProfile(profileDir)
  const loaded = await loadBenchmark(benchmarkDir, { workspace, allowInsideWorkspace: false })
  const before = loaded.digest
  await fs.writeFile(path.join(benchmarkDir, 'private', 'case-a.md'), 'CHANGED_PRIVATE_RULE')
  const changed = await loadBenchmark(benchmarkDir, { workspace, allowInsideWorkspace: false })
  assert.notEqual(changed.digest, before)

  await fs.writeFile(path.join(benchmarkDir, 'private', 'case-a.md'), 'PRIVATE_GOLD_NEVER_LEAK')
  const benchmark = await loadBenchmark(benchmarkDir, { workspace, allowInsideWorkspace: false })
  const config = resolveConfig({ stateRoot: path.join(temporary, 'state') })
  const profile = await loadProfile(profileDir, config)
  const prompt = optimizerPrompt({
    parent: { options: {}, session: { header: { id: 'parent', cwd: workspace } } },
    signal: new AbortController().signal,
    profile,
    benchmark,
    evidence: {
      reference: {
        profileVersion: 1,
        score: 50,
        runsPerCase: 1,
        cases: [{
          caseId: 'case-a',
          statement: 'Produce a concise answer.',
          score: 50,
          runs: [{
            run: 1,
            score: 50,
            publicFeedback: 'The answer was too long.',
            behaviorTags: ['verbosity'],
            targetOutput: 'A long answer.',
            targetSessionId: 'target-1',
          }],
        }],
      },
      rejectedCandidates: [],
    },
    priorCandidates: [],
  }, config)
  assert.equal(prompt.includes('PRIVATE_GOLD_NEVER_LEAK'), false)
  assert.equal(prompt.includes('private/case-a.md'), false)
  assert.match(prompt, /The answer was too long/)

  const exposedBenchmark = path.join(workspace, 'benchmark')
  await createBenchmark(exposedBenchmark)
  await assert.rejects(
    loadBenchmark(exposedBenchmark, { workspace, allowInsideWorkspace: false }),
    /inside the target workspace/,
  )
  await fs.rm(temporary, { recursive: true, force: true })
})
