/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-compaction-micro`.
 * @module @deepseek-ai/dsh-compaction-micro/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-compaction-micro'

/** Cordis companion plugin name. */
export const name = 'compaction-micro-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: Session validates each content-only rewrite, and the
 * freeze/idempotence contract (a collapsed placeholder is never re-decided) is
 * enforced at the source by {@link isMicrocompactPlaceholder} marker detection
 * rather than a cross-event postcondition.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
