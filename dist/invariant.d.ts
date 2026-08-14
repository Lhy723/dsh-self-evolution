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
import type { Context } from '@deepseek-ai/cordis';
/** Cordis companion plugin name. */
export declare const name = "self-evolution-invariant";
/** Service required before the companion can reserve package ownership. */
export declare const inject: readonly ["invariants"];
/**
 * Register the self-evolution invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export declare function apply(ctx: Context): Promise<() => void>;
//# sourceMappingURL=invariant.d.ts.map