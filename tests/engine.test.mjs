import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EvolutionEngine } from '../dist/engine.js'
import { resolveConfig } from '../dist/config.js'

async function createFixture(prefix, agentsText) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const workspace = path.join(temporary, 'workspace')
  const profile = path.join(workspace, 'profile')
  const benchmark = path.join(temporary, 'private-benchmark')
  const stateRoot = path.join(temporary, 'state')
  await fs.mkdir(profile, { recursive: true })
  await fs.mkdir(path.join(benchmark, 'public'), { recursive: true })
  await fs.mkdir(path.join(benchmark, 'private'), { recursive: true })
  await fs.writeFile(path.join(profile, 'AGENTS.md'), agentsText)
  await fs.writeFile(path.join(profile, 'runtime.json'), JSON.stringify({ schemaVersion: 1, version: 1 }, null, 2))
  await fs.writeFile(path.join(benchmark, 'benchmark.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'quality',
    title: 'Quality',
    frozen: true,
    cases: [{ id: 'one', statementFile: 'public/one.md', rubricFile: 'private/one.md' }],
  }, null, 2))
  await fs.writeFile(path.join(benchmark, 'public', 'one.md'), 'Answer the task well.')
  await fs.writeFile(path.join(benchmark, 'private', 'one.md'), 'PRIVATE_RUBRIC_CONTENT')
  return { temporary, workspace, profile, benchmark, stateRoot }
}

class MockWorker {
  constructor({ proposal, scoreFor }) {
    this.proposal = proposal
    this.scoreFor = scoreFor
    this.counter = 0
  }
  async runTarget(request) {
    this.counter += 1
    return {
      sessionId: `target-${this.counter}`,
      output: request.profile.agentsMarkdown,
      stopReason: 'completed',
      durationMs: 5,
    }
  }
  async runEvaluator(request) {
    this.counter += 1
    return {
      valid: true,
      score: this.scoreFor(request.target.output),
      publicFeedback: 'Observable public feedback only.',
      privateNotes: 'PRIVATE_RUBRIC_CONTENT and detailed rationale.',
      behaviorTags: ['quality'],
      sessionId: `evaluator-${this.counter}`,
      stopReason: 'completed',
      durationMs: 5,
    }
  }
  async runOptimizer() {
    this.counter += 1
    return {
      sessionId: `optimizer-${this.counter}`,
      stopReason: 'completed',
      durationMs: 5,
      proposal: this.proposal,
    }
  }
}

const parentFor = workspace => ({
  id: 'parent',
  options: {},
  session: { header: { id: 'parent', cwd: workspace } },
})

const logger = { info() {}, warn() {}, error() {} }

test('engine accepts a strictly better candidate and snapshots both versions', async () => {
  const fixture = await createFixture('dsh-evolution-accept-', '# Agent\nBASELINE_BEHAVIOR\n')
  const config = resolveConfig({ stateRoot: fixture.stateRoot, minImprovement: 0 })
  const worker = new MockWorker({
    proposal: {
      hypothesis: 'Explicit verification guidance improves quality.',
      expectedBehavior: 'The answer demonstrates improved behavior.',
      summary: 'Upgrade AGENTS.md.',
      operations: [{ op: 'upsert', path: 'AGENTS.md', content: '# Agent\nIMPROVED_BEHAVIOR\n' }],
    },
    scoreFor: output => output.includes('IMPROVED_BEHAVIOR') ? 90 : 40,
  })
  const engine = new EvolutionEngine(config, worker, logger)
  const result = await engine.evolve(parentFor(fixture.workspace), new AbortController().signal, {
    profileDir: fixture.profile,
    benchmarkDir: fixture.benchmark,
    rounds: 1,
    runsPerCase: 1,
    baselineRuns: 1,
    targetScore: 80,
    adoptExternalChanges: false,
  })
  assert.equal(result.finalVersion, 2)
  assert.equal(result.baselineScore, 40)
  assert.equal(result.finalScore, 90)
  assert.equal(result.acceptedRounds, 1)
  assert.equal(result.stopReason, 'target-score-reached')
  assert.match(await fs.readFile(path.join(fixture.profile, 'AGENTS.md'), 'utf8'), /IMPROVED_BEHAVIOR/)
  const runtime = JSON.parse(await fs.readFile(path.join(fixture.profile, 'runtime.json'), 'utf8'))
  assert.equal(runtime.version, 2)
  const snapshotRoot = path.join(fixture.stateRoot, 'profiles')
  const profileStateDirs = await fs.readdir(snapshotRoot)
  const snapshots = await fs.readdir(path.join(snapshotRoot, profileStateDirs[0], 'snapshots'))
  assert.deepEqual(snapshots.sort(), ['v1', 'v2'])
  const scoreboard = JSON.parse(await fs.readFile(result.scoreboardPath, 'utf8'))
  assert.equal(scoreboard.entries.length, 2)
  assert.deepEqual(scoreboard.entries.map(entry => entry.kind), ['baseline', 'accepted-candidate'])
  assert.ok(result.sessionIds.some(id => id.startsWith('optimizer-')))

  const rolledBack = await engine.rollback(
    parentFor(fixture.workspace),
    new AbortController().signal,
    fixture.profile,
    1,
  )
  assert.equal(rolledBack.finalVersion, 1)
  assert.match(await fs.readFile(path.join(fixture.profile, 'AGENTS.md'), 'utf8'), /BASELINE_BEHAVIOR/)
  const status = await engine.status(fixture.profile)
  assert.equal(status.currentVersion, 1)
  assert.equal(status.nextVersion, 3)
  assert.equal(status.drifted, false)
  await fs.rm(fixture.temporary, { recursive: true, force: true })
})

test('engine rejects a worse candidate and restores the exact reference', async () => {
  const fixture = await createFixture('dsh-evolution-reject-', '# Agent\nGOOD_REFERENCE\n')
  const config = resolveConfig({ stateRoot: fixture.stateRoot, minImprovement: 0 })
  const worker = new MockWorker({
    proposal: {
      hypothesis: 'A risky rewrite might improve quality.',
      expectedBehavior: 'The behavior changes.',
      summary: 'Risky rewrite.',
      operations: [{ op: 'upsert', path: 'AGENTS.md', content: '# Agent\nBAD_CANDIDATE\n' }],
    },
    scoreFor: output => output.includes('GOOD_REFERENCE') ? 80 : 30,
  })
  const engine = new EvolutionEngine(config, worker, logger)
  const result = await engine.evolve(parentFor(fixture.workspace), new AbortController().signal, {
    profileDir: fixture.profile,
    benchmarkDir: fixture.benchmark,
    rounds: 1,
    runsPerCase: 1,
    baselineRuns: 1,
    adoptExternalChanges: false,
  })
  assert.equal(result.finalVersion, 1)
  assert.equal(result.finalScore, 80)
  assert.equal(result.acceptedRounds, 0)
  assert.equal(result.rejectedRounds, 1)
  assert.match(await fs.readFile(path.join(fixture.profile, 'AGENTS.md'), 'utf8'), /GOOD_REFERENCE/)
  const runtime = JSON.parse(await fs.readFile(path.join(fixture.profile, 'runtime.json'), 'utf8'))
  assert.equal(runtime.version, 1)
  const scoreboard = JSON.parse(await fs.readFile(result.scoreboardPath, 'utf8'))
  assert.equal(scoreboard.entries.length, 1)
  assert.equal(scoreboard.entries[0].kind, 'baseline')
  const run = JSON.parse(await fs.readFile(path.join(result.runDirectory, 'run.json'), 'utf8'))
  assert.equal(run.rounds[0].decision, 'rejected')
  await fs.rm(fixture.temporary, { recursive: true, force: true })
})

test('engine refuses to overwrite an external change made during candidate evaluation', async () => {
  const fixture = await createFixture('dsh-evolution-drift-', '# Agent\nBASELINE\n')
  const config = resolveConfig({ stateRoot: fixture.stateRoot })
  let counter = 0
  const worker = {
    async runTarget(request) {
      counter += 1
      return {
        sessionId: `target-${counter}`,
        output: request.profile.agentsMarkdown,
        stopReason: 'completed',
        durationMs: 1,
      }
    },
    async runEvaluator(request) {
      counter += 1
      if (request.target.output.includes('CANDIDATE')) {
        await fs.writeFile(path.join(fixture.profile, 'AGENTS.md'), '# Agent\nHUMAN_EXTERNAL_CHANGE\n')
      }
      return {
        valid: true,
        score: request.target.output.includes('CANDIDATE') ? 95 : 20,
        publicFeedback: 'feedback',
        privateNotes: 'private',
        behaviorTags: [],
        sessionId: `evaluator-${counter}`,
        stopReason: 'completed',
        durationMs: 1,
      }
    },
    async runOptimizer() {
      counter += 1
      return {
        sessionId: `optimizer-${counter}`,
        stopReason: 'completed',
        durationMs: 1,
        proposal: {
          hypothesis: 'candidate',
          expectedBehavior: 'candidate',
          summary: 'candidate',
          operations: [{ op: 'upsert', path: 'AGENTS.md', content: '# Agent\nCANDIDATE\n' }],
        },
      }
    },
  }
  const engine = new EvolutionEngine(config, worker, logger)
  await assert.rejects(
    engine.evolve(parentFor(fixture.workspace), new AbortController().signal, {
      profileDir: fixture.profile,
      benchmarkDir: fixture.benchmark,
      rounds: 1,
      runsPerCase: 1,
      baselineRuns: 1,
      adoptExternalChanges: false,
    }),
    /profile changed concurrently/,
  )
  assert.match(await fs.readFile(path.join(fixture.profile, 'AGENTS.md'), 'utf8'), /HUMAN_EXTERNAL_CHANGE/)
  const status = await engine.status(fixture.profile)
  assert.equal(status.drifted, true)
  await fs.rm(fixture.temporary, { recursive: true, force: true })
})
