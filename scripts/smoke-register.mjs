/**
 * Real-runtime registration smoke: boots a minimal Cordis context with the
 * REAL @deepseek-ai/dsh-tools registry and the REAL dsh-invariants registry,
 * mounts the built dsh-self-evolution plugin, and asserts:
 *
 *  1. the four model-visible evolution_* tools register through the real
 *     registry (which enforces assertSupportedJsonSchema on every definition);
 *  2. the ./invariant companion registers through the real invariant registry;
 *  3. disposing the plugin fiber removes the tools again (HMR-safety).
 *
 * Run from the package root with the real DeepSeek Harness packages resolvable
 * (node_modules/@deepseek-ai symlinks or an installed profile).
 */
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SelfEvolutionService from '../dist/index.js'
import * as invariant from '../dist/invariant.js'

const EXPECTED_TOOLS = ['evolution_run', 'evolution_evaluate', 'evolution_status', 'evolution_rollback']

// The plugin injects `subagents`; registration never calls it, so a stub that
// fails loudly proves nothing spurious executed during mount.
class SubagentsStub extends Service {
  constructor(ctx) {
    super(ctx, 'subagents')
  }

  start() {
    throw new Error('subagents.start must not be called during registration smoke')
  }
}

const names = schemas => schemas.map(schema => schema.name)

const root = new Context()
await root.plugin(SystemPrompt)
await root.plugin(ToolRuntime)
await root.plugin(InvariantRegistry)
await root.plugin(SubagentsStub)
const evolutionFiber = await root.plugin(SelfEvolutionService)

const before = names(root.tools.schemas())
const missing = EXPECTED_TOOLS.filter(name => !before.includes(name))
if (missing.length > 0) {
  throw new Error(`tools missing after mount: ${missing.join(', ')} (registered: ${before.join(', ')})`)
}
console.log('PASS: four evolution_* tools registered through the real registry:', before.filter(n => n.startsWith('evolution_')).join(', '))

const disposeInvariant = await invariant.apply(root)
console.log('PASS: invariant companion registered through the real registry')

// HMR-safety: the plugin fiber owns its registrations.
await evolutionFiber.dispose()
const after = names(root.tools.schemas())
const leaked = EXPECTED_TOOLS.filter(name => after.includes(name))
if (leaked.length > 0) throw new Error(`tools leaked after dispose: ${leaked.join(', ')}`)
console.log('PASS: disposing the plugin fiber removed every evolution_* tool')
disposeInvariant()
console.log('SMOKE OK')
