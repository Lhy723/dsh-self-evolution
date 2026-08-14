/**
 * Package-owned runtime invariants for dsh-self-evolution.
 *
 * The DeepSeek Harness invariant registry loads this companion through the
 * package's `./invariant` export. The plugin has no runtime event stream of its
 * own, so the invariant checks the one externally observable relation it does
 * own: the four model-visible `evolution_*` tools must be registered
 * atomically (all or none). A half-registered set means a registration or
 * scope error split the plugin's tool surface and would confuse the model.
 * @module dsh-self-evolution/invariant
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-self-evolution'

/** Cordis companion plugin name. */
export const name = 'self-evolution-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'] as const

const TOOL_NAMES = [
  'evolution_run',
  'evolution_evaluate',
  'evolution_status',
  'evolution_rollback',
] as const

function check(tools: ToolRuntime, fail: InvariantFailure): void {
  const present = TOOL_NAMES.map(toolName => tools.schemas().some(schema => schema.name === toolName))
  const count = present.filter(value => value).length
  if (count !== 0 && count !== TOOL_NAMES.length) {
    fail(`model-visible tools must be registered atomically: ${TOOL_NAMES.join(', ')} (${count}/${TOOL_NAMES.length} present)`)
  }
}

const install = Object.assign((ctx: Context, fail: InvariantFailure): void => {
  check(ctx.tools, fail)
  ctx.on('tools/change', () => check(ctx.tools, fail), { global: true })
}, { inject: ['tools'] as const }) satisfies InvariantInstaller

/**
 * Register the self-evolution invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export async function apply(ctx: Context): Promise<() => void> {
  return ctx.invariants.register(PACKAGE_NAME, install)
}
