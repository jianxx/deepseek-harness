/** Package-owned permission invariant: the session mode vocabulary stays closed. @module @deepseek-ai/dsh-permission-rules/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { PermissionMode } from './types.ts'
import { PERMISSION_MODES } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-permission-rules'

/** Cordis companion plugin name. */
export const name = 'permission-rules-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Fail unless a `permission/mode` payload is in the closed vocabulary. */
function validateMode(mode: unknown, fail: InvariantFailure): void {
  if (!PERMISSION_MODES.includes(mode as PermissionMode)) {
    fail(`permission/mode carries unknown mode ${JSON.stringify(mode)}`)
  }
}

/** Reject any `permission/mode` payload outside the closed vocabulary, pre-commit. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const seed = (session: Session): void => {
    for (const event of session.events) {
      if (event.type === 'permission/mode') validateMode(event.data.mode, fail)
    }
  }
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    if (event.type === 'permission/mode') validateMode(event.data.mode, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the permission-mode invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

export default apply
