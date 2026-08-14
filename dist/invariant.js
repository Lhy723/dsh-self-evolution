const PACKAGE_NAME = 'dsh-self-evolution';
/** Cordis companion plugin name. */
export const name = 'self-evolution-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
const TOOL_NAMES = [
    'evolution_run',
    'evolution_evaluate',
    'evolution_status',
    'evolution_rollback',
];
function check(tools, fail) {
    const present = TOOL_NAMES.map(toolName => tools.schemas().some(schema => schema.name === toolName));
    const count = present.filter(value => value).length;
    if (count !== 0 && count !== TOOL_NAMES.length) {
        fail(`model-visible tools must be registered atomically: ${TOOL_NAMES.join(', ')} (${count}/${TOOL_NAMES.length} present)`);
    }
}
const install = Object.assign((ctx, fail) => {
    check(ctx.tools, fail);
    ctx.on('tools/change', () => check(ctx.tools, fail), { global: true });
}, { inject: ['tools'] });
/**
 * Register the self-evolution invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export async function apply(ctx) {
    return ctx.invariants.register(PACKAGE_NAME, install);
}
//# sourceMappingURL=invariant.js.map