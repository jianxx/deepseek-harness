import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Microcompactor, {
  DEFAULTS,
  MICROCOMPACT_MARKER,
  isMicrocompactPlaceholder,
  resolveConfig,
  reuseSpillLocator,
} from '@deepseek-ai/dsh-compaction-micro'
import type { MicrocompactConfig } from '@deepseek-ai/dsh-compaction-micro'

const MODEL = 'test-model'

function service(config: MicrocompactConfig = { retainResults: 2 }): Microcompactor {
  const ctx = new Context()
  // Service constructors self-register, so `ctx.tokenMeter` resolves for the
  // shadow-price pricing without a full plugin boot.
  void new TokenMeter(ctx)
  return new Microcompactor(ctx, config)
}

function session(): Session {
  return Session.create(SessionId('test'))
}

const TEXT = { type: 'text' as const }

function appendToolStep(
  s: Session,
  turn: number,
  call: string,
  text: string,
): number {
  const callId = CallId(call)
  s.append('turn/start', { turn })
  s.append('step/start', { turn, step: 1 })
  s.append('assistant/message', {
    turn,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: callId, name: 'bash', arguments: '{}' }],
      source: { kind: 'model', ...{ provider: MODEL, model: MODEL } },
    }),
  }, { surfaceOp: 'append' })
  s.append('tool/call', { turn, step: 1, callId, name: 'bash', arguments: '{}' })
  const result = s.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({ callId, content: [{ type: 'text', text }], isError: false }),
  }, { surfaceOp: 'append' })
  s.append('step/end', { turn, step: 1 })
  s.append('turn/end', { turn, reason: { kind: 'completed' } })
  return result.seq
}

/** All current-surface tool/result node seqs in surface order. */
function surfaceToolResults(s: Session): number[] {
  const seqs: number[] = []
  for (const seq of [...s.surface.nodes]) {
    if (s.events[seq]?.type === 'tool/result') seqs.push(seq)
  }
  return seqs
}

function replacementText(s: Session, call: string): string | undefined {
  for (const seq of [...s.surface.nodes]) {
    const event = s.events[seq]
    if (event?.type !== 'tool/result') continue
    const msg = event.data.message as SessionEvent<'tool/result'>['data']['message']
    if (msg.source.callId !== CallId(call)) continue
    const block = msg.content[0]
    return block?.type === 'tool-result' && block.content[0]?.type === 'text'
      ? block.content[0].text
      : undefined
  }
  return undefined
}

describe('microcompact configuration', () => {
  it('resolves detached immutable defaults and partial overrides', () => {
    const raw = { retainResults: 4, auto: true, placeholderChars: 100 }
    const resolved = resolveConfig(raw)
    raw.retainResults = 1
    expect(resolved).toEqual({ retainResults: 4, auto: true, placeholderChars: 100 })
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(DEFAULTS).toEqual({ retainResults: 10, auto: false, placeholderChars: 256 })
    expect(Object.isFrozen(DEFAULTS)).toBe(true)
  })

  it('rejects stale keys and invalid scalars', () => {
    const bad = [
      [{ retainResults: 0 }, /retainResults .* positive integer/],
      [{ retainResults: -1 }, /retainResults .* positive integer/],
      [{ retainResults: 1.5 }, /retainResults .* positive integer/],
      [{ placeholderChars: 0 }, /placeholderChars .* positive integer/],
      [{ window: 5 }, /unknown key "window"/],
    ] as Array<[unknown, RegExp]>
    for (const [config, pattern] of bad) {
      expect(() => resolveConfig(config as MicrocompactConfig)).toThrow(pattern)
    }
  })
})

describe('spill locator extraction', () => {
  it('extracts a rendered locator sentence', () => {
    expect(reuseSpillLocator('plain output')).toBeUndefined()
    expect(reuseSpillLocator('Full grep result stored at: /tmp/x/abc123. Read it with read.')).toBe(
      'Full result still available at: /tmp/x/abc123.',
    )
  })
})

describe('Microcompactor window + freeze', () => {
  it('keeps the most recent N tool results verbatim and collapses older ones', () => {
    const micro = service({ retainResults: 2 })
    const s = session()
    for (let i = 1; i <= 5; i++) appendToolStep(s, i, `call-${i}`, `result ${i}`)

    const before = surfaceToolResults(s)
    expect(before).toHaveLength(5)
    const result = micro.microcompactSession(s)

    // retrain 2 → collapse the oldest 3.
    expect(result.replaced).toHaveLength(3)
    expect(result.stable).toBe(false)
    expect(result.replaced.map(e => e.callId)).toEqual(
      [1, 2, 3].map(i => CallId(`call-${i}`)),
    )
    // Newest two are untouched verbatim.
    expect(replacementText(s, 'call-4')).toBe('result 4')
    expect(replacementText(s, 'call-5')).toBe('result 5')
    // Oldest three became placeholders.
    for (const i of [1, 2, 3]) {
      expect(replacementText(s, `call-${i}`)!.startsWith(MICROCOMPACT_MARKER)).toBe(true)
    }
    // Placeholder content begins with the marker (freeze detection).
    const ph = replacementText(s, 'call-1')!
    expect(isMicrocompactPlaceholder([{ type: 'text', text: ph }])).toBe(true)
  })

  it('is idempotent: a second pass emits no replacement and a byte-identical prompt', () => {
    const micro = service({ retainResults: 2 })
    const s = session()
    for (let i = 1; i <= 4; i++) appendToolStep(s, i, `call-${i}`, `result ${i}`)

    micro.microcompactSession(s)
    const surfaceAfterFirst = s.surface.nodes.slice()
    const firstEnd = surfaceToolResults(s)

    const second = micro.microcompactSession(s)
    expect(second.replaced).toHaveLength(0)
    expect(second.stable).toBe(true)
    // Surface (and thus the projected prompt) is unchanged on re-run.
    expect(s.surface.nodes.slice()).toEqual(surfaceAfterFirst)
    expect(surfaceToolResults(s)).toEqual(firstEnd)
  })

  it('recognizes an already-collapsed result and never re-decides it', () => {
    const micro = service({ retainResults: 1 })
    const s = session()
    appendToolStep(s, 1, 'a', 'big result')
    appendToolStep(s, 2, 'b', 'kept')
    micro.microcompactSession(s)
    // With retainResults 1, the remaining 'b' is within the window; the
    // placeholder 'a' is skipped via marker detection, so nothing collapses.
    const second = micro.microcompactSession(s)
    expect(second.replaced).toHaveLength(0)
  })

  it('records the decision in a compaction/microcompact session event, reconstructable from the log', () => {
    const micro = service({ retainResults: 2 })
    const s = session()
    for (let i = 1; i <= 4; i++) appendToolStep(s, i, `call-${i}`, `result ${i}`)
    const originalSeqs = surfaceToolResults(s)

    micro.microcompactSession(s)

    // The durable decision records name each shadowed original and its marker replacement.
    const records = s.events
      .filter((e): e is SessionEvent<'compaction/microcompact'> => e.type === 'compaction/microcompact')
      .map(e => e.data)
    expect(records).toHaveLength(2)
    // The oldest two (seqs originalSeqs[0..1]) were collapsed.
    expect(records.map(r => r.originalSeq)).toEqual([originalSeqs[0], originalSeqs[1]])
    expect(records.map(r => r.callId)).toEqual([CallId('call-1'), CallId('call-2')])
    // Each record's replacementSeq is a current-surface node whose content is the placeholder.
    for (const record of records) {
      const replacement = s.events[record.replacementSeq]
      expect(replacement?.type).toBe('tool/result')
      const block = (replacement!.data as SessionEvent<'tool/result'>['data']).message.content[0]
      expect(block?.type === 'tool-result' && block.content[0]?.type === 'text'
        && block.content[0].text.startsWith(MICROCOMPACT_MARKER)).toBe(true)
      // Decision is reconstructable purely from log + code.
      expect(replacement!.sourceEventSeqs).toContain(record.originalSeq)
    }
  })

  it('re-embeds a cited spill locator into the placeholder', () => {
    const micro = service({ retainResults: 1 })
    const s = session()
    appendToolStep(s, 1, 'a', 'Full grep result stored at: /tmp/spill/xyz. Read with read.')
    appendToolStep(s, 2, 'b', 'kept')
    micro.microcompactSession(s)
    const ph = replacementText(s, 'a')!
    expect(ph).toContain('Full result still available at: /tmp/spill/xyz.')
    // Recorded in the durable decision event.
    const record = s.events.find(e => e.type === 'compaction/microcompact')?.data as
      SessionEvent<'compaction/microcompact'>['data']
    expect(record.spillLocator).toBe('Full result still available at: /tmp/spill/xyz.')
  })

  it('keeps every result when all are within the retention window (stable pass)', () => {
    const micro = service({ retainResults: 10 })
    const s = session()
    for (let i = 1; i <= 3; i++) appendToolStep(s, i, `call-${i}`, `result ${i}`)
    const result = micro.microcompactSession(s)
    expect(result.replaced).toHaveLength(0)
    expect(result.stable).toBe(true)
  })
})

describe('Microcompactor content guard', () => {
  it('treats non-tool-result tool/result messages safely and skips non-text placeholders', () => {
    expect(isMicrocompactPlaceholder([{ type: 'text', text: 'x' }])).toBe(false)
    expect(isMicrocompactPlaceholder([TEXT])).toBe(false)
    expect(isMicrocompactPlaceholder([
      { type: 'text', text: `${MICROCOMPACT_MARKER} extra` },
    ])).toBe(true)
  })

  it('invariant companion loads as a plugin and reserves its package name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const MicroInvariant = await import('@deepseek-ai/dsh-compaction-micro/invariant')
    await ctx.plugin(MicroInvariant)
    // The plugin install reserves the package name against duplicate registration.
    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-compaction-micro', () => {})
    }).toThrow(/already registered/)
  })
})
