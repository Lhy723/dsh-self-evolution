import test from 'node:test'
import assert from 'node:assert/strict'
import { DshSubagentWorker } from '../dist/worker.js'
import { resolveConfig } from '../dist/config.js'

const parent = {
  id: 'parent',
  options: { provider: 'provider-a', model: 'model-a' },
  session: { header: { id: 'parent', cwd: '/workspace' } },
}
const profile = {
  directory: '/workspace/profile',
  agentsMarkdown: '# Agent',
  runtime: { schemaVersion: 1, version: 1, toolFilter: { deny: ['existing-deny'] } },
  skills: [],
  configFiles: [],
  digest: 'profile-digest',
  files: [],
}
const benchmarkCase = {
  id: 'case-a',
  statement: 'Do the public task.',
  rubric: 'Private scoring rule.',
  weight: 1,
  tags: [],
  statementSource: 'inline',
  rubricSource: 'private/case-a.md',
}
const benchmark = {
  directory: '/private/benchmark',
  manifest: { schemaVersion: 1, id: 'bench', title: 'Bench', frozen: true, cases: [] },
  cases: [benchmarkCase],
  digest: 'benchmark-digest',
}

test('DeepSeek worker adapter uses scoped restrictions and structured child outputs', async () => {
  const calls = []
  let index = 0
  const ctx = {
    subagents: {
      async start(provider, request) {
        calls.push({ provider, request })
        index += 1
        const structured = index === 2
          ? { valid: true, score: 77, publicFeedback: 'public', privateNotes: 'private', behaviorTags: ['tag'] }
          : index === 3
            ? {
                hypothesis: 'h',
                expectedBehavior: 'e',
                summary: 's',
                operations: [{ op: 'upsert', path: 'AGENTS.md', content: '# Better' }],
              }
            : undefined
        return {
          id: `session-${index}`,
          result: Promise.resolve({
            output: [{ type: 'text', text: index === 1 ? 'target output' : '' }],
            stopReason: 'completed',
            ...(structured === undefined ? {} : { structured }),
          }),
          async dispose() {},
        }
      },
    },
  }
  const config = resolveConfig({ stateRoot: '/state' })
  const worker = new DshSubagentWorker(ctx, config, ['evolution_run', 'evolution_evaluate'])
  const signal = new AbortController().signal
  const target = await worker.runTarget({
    parent,
    signal,
    profile,
    benchmark,
    benchmarkCase,
    runIndex: 1,
    toolFilter: profile.runtime.toolFilter,
  })
  assert.equal(target.sessionId, 'session-1')
  assert.deepEqual(calls[0].request.toolFilter.deny.sort(), ['evolution_evaluate', 'evolution_run', 'existing-deny'])
  assert.match(calls[0].request.persona, /# Agent/)

  const evaluation = await worker.runEvaluator({
    parent,
    signal,
    benchmark,
    benchmarkCase,
    target,
    profileVersion: 1,
    runIndex: 1,
  })
  assert.equal(evaluation.score, 77)
  assert.deepEqual(calls[1].request.toolFilter, { allow: [] })
  assert.equal(calls[1].request.outputSchema.type, 'object')
  assert.match(calls[1].request.prompt[0].text, /Private scoring rule/)

  const optimization = await worker.runOptimizer({
    parent,
    signal,
    profile,
    benchmark,
    evidence: {
      reference: { profileVersion: 1, score: 77, runsPerCase: 1, cases: [] },
      rejectedCandidates: [],
    },
    priorCandidates: [],
  })
  assert.equal(optimization.proposal.operations[0].path, 'AGENTS.md')
  assert.deepEqual(calls[2].request.toolFilter, { allow: [] })
  assert.equal(calls[2].request.prompt[0].text.includes('Private scoring rule'), false)
  assert.equal(calls.every(call => call.provider === 'spawn'), true)
})
