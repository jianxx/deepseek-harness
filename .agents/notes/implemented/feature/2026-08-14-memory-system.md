# Agent Note: File-based memory system

Status: implemented

English | [中文](2026-08-14-memory-system.zh.md)

## Problem

The harness had no cross-session, model-visible persistence for durable facts
about the user, their preferences, project context, or external resources. A
conversation's context died at the end of its session. Claude Code's memdir
(`MEMORY.md` index + topic files, an auto-extraction pass, and a nightly
consolidation) is the reference design we wanted, adapted to the harness's
capability-seam model.

## Decision

Two packages under a new `packages/memory/` group:

- `dsh-memory` owns the read side: the memdir format and parser, the `memory`
  system-prompt section, and dynamic recall.
- `dsh-memory-consolidation` owns the write side: turn-end extraction and a
  three-gate dream rewrite, using `ctx.jobs` + `ctx.subagents` for background
  forked subagents restricted to read/search plus memory-write tools.

All file access goes through the optional `ctx.fs` seam, so a remote or
sandboxed backend works unchanged; a providerless host mounts memory as a
no-op. Recall deduplicates per agent-session: topic files already injected this
session are never re-injected. Memory writes change model-visible context
through the existing `memory` section re-assembled via `system-prompt/change` —
this package set introduces no new session event for the memory files
themselves (the files are the durable layer).

## Deviations from the Claude Code reference

The `ctx.fs` seam exposes no `mtime` (`stat` returns `version`/`type`/`size`
only), so two reference behaviors are re-routed:

- **Lock**: the consolidation lock stores the holder PID and the
  last-consolidated epoch in the lock file's **body** rather than in the file
  mtime. Crash recovery relies on a stale window (`LOCK_STALE_MS`, default
  1 hour) reclaiming a stale holder, not on process-liveness probing.
- **Recall freshness**: deduplication tracks shown paths per session rather
  than mtime+path; content is re-read fresh on each injection, which still
  reflects on-disk changes.

Two further scopes are approximated because the seams are under-specified here:
the session-count gate counts live `ctx.sessions` as new (a clocked transcript
query is deferred), and Write/Edit path-scoping to the memory directory is
enforced by the fork prompt contract, not by a path-aware tool guard
(`ctx.tools.restrict` filters by tool name).

## Testing

TDD-driven: frontmatter parsing, entrypoint truncation, section assembly,
recall JSON extraction, the three gates individually and combined, lock
acquire/rollback/stale-reclaim, and the memory tool filter are all unit-tested
against an in-memory `ctx.fs` provider (no stock provider ships, so tests
mount a local `FileSystem` subclass per the repo convention) and a fake
subagent seam. `pnpm vitest run packages/memory` passes; both packages
typecheck clean.
