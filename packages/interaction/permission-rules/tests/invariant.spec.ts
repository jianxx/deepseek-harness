import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import * as permissionRulesInvariant from '@deepseek-ai/dsh-permission-rules/invariant'

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(permissionRulesInvariant)
  return ctx
}

describe('permission-rules invariant companion', () => {
  it('accepts a known permission/mode value', async () => {
    const ctx = await mount()
    const session = ctx.sessions.create(SessionId('good'))
    expect(() => session.append('permission/mode', { mode: 'acceptEdits' })).not.toThrow()
  })

  it('rejects an unknown permission/mode value', async () => {
    const ctx = await mount()
    const session = ctx.sessions.create(SessionId('bad'))
    expect(() => session.append('permission/mode', { mode: 'wontparse' as never }))
      .toThrow(InvariantError)
  })

  it('rebuilds an invalid mode from an existing session at mount', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('seeded'))
    session.append('permission/mode', { mode: 'future-mode' as never })
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(permissionRulesInvariant)).rejects.toThrow(/permission\/mode carries unknown mode/)
  })

  it('does not interfere with a bare session first observed through publication', async () => {
    const ctx = await mount()
    const session = Session.create(SessionId('bare'))
    expect(() => {
      ctx.emit('session/event', session, {
        type: 'permission/mode', seq: 0, time: 0, data: { mode: 'plan' },
      })
    }).not.toThrow()
  })
})
