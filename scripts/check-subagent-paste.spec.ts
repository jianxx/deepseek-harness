/** Tests for the check-subagent-paste Stop hook, run as a subprocess. */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const hook = join(import.meta.dirname, 'check-subagent-paste.mjs')

function runHook(stdin: string, env: Record<string, string> = {}) {
  const res = spawnSync('node', [hook], {
    input: stdin,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  })
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', status: res.status }
}

function quotedBlock(numLines: number): string[] {
  return Array.from({ length: numLines }, (_, i) => `> filler line ${i + 1}`)
}

function messagePayload(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ last_assistant_message: text, ...extra })
}

describe('check-subagent-paste', () => {
  it("flags a ≥40-line '>'-quoted block with the fast-worker contract pair", () => {
    const block = quotedBlock(45)
    block[5] = '> Changed: src/foo.ts (edited), src/bar.ts (edited)'
    block[20] = '> Deviations: none'
    const { stdout, status } = runHook(messagePayload(block.join('\n')), { SUBAGENT_PASTE_HOOK: '' })
    expect(status).toBe(0)
    expect(JSON.parse(stdout)).toHaveProperty('systemMessage')
  })

  it('flags a ≥40-line fenced block with the deep-reasoner contract pair', () => {
    const fence = Array.from({ length: 42 }, (_, i) => `filler line ${i + 1}`)
    fence[3] = 'Recommendation: approve'
    fence[30] = 'Risks/unknowns: none'
    const { stdout, status } = runHook(messagePayload(['```', ...fence, '```'].join('\n')), { SUBAGENT_PASTE_HOOK: '' })
    expect(status).toBe(0)
    expect(JSON.parse(stdout)).toHaveProperty('systemMessage')
  })

  it('passes a short normal message', () => {
    const { stdout, status } = runHook(messagePayload('Done. Edited 2 files.'), { SUBAGENT_PASTE_HOOK: '' })
    expect(status).toBe(0)
    expect(stdout).toBe('')
  })

  it('passes a ≥40-line quoted block with only one unpaired contract header', () => {
    const block = quotedBlock(45)
    block[10] = '> Recommendation: approve'
    const { stdout, status } = runHook(messagePayload(block.join('\n')), { SUBAGENT_PASTE_HOOK: '' })
    expect(status).toBe(0)
    expect(stdout).toBe('')
  })

  it('passes a contract pair below the 40-line run threshold', () => {
    const block = quotedBlock(39)
    block[5] = '> Changed: src/foo.ts (edited)'
    block[20] = '> Deviations: none'
    const { stdout, status } = runHook(messagePayload(block.join('\n')), { SUBAGENT_PASTE_HOOK: '' })
    expect(status).toBe(0)
    expect(stdout).toBe('')
  })

  it('fails closed on invalid JSON stdin', () => {
    const { stdout, status } = runHook('not json {{{')
    expect(status).toBe(0)
    expect(stdout).toBe('')
  })

  it('fails closed when last_assistant_message is missing', () => {
    const { stdout, status } = runHook(JSON.stringify({ session_id: 'abc', stop_hook_active: false }))
    expect(status).toBe(0)
    expect(stdout).toBe('')
  })

  it('block mode emits a block decision on a hit', () => {
    const block = quotedBlock(45)
    block[5] = '> Changed: src/foo.ts (edited)'
    block[20] = '> Deviations: none'
    const { stdout, status } = runHook(messagePayload(block.join('\n')), { SUBAGENT_PASTE_HOOK: 'block' })
    expect(status).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ decision: 'block' })
  })

  it('block mode stands down while stop_hook_active to avoid the block-cap loop', () => {
    const block = quotedBlock(45)
    block[5] = '> Changed: src/foo.ts (edited)'
    block[20] = '> Deviations: none'
    const { stdout, status } = runHook(messagePayload(block.join('\n'), { stop_hook_active: true }), {
      SUBAGENT_PASTE_HOOK: 'block',
    })
    expect(status).toBe(0)
    expect(stdout).toBe('')
  })
})
