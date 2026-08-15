# Agent Note: Git worktree tools — EnterWorktree / ExitWorktree over the shell seam

Status: implemented

English | [中文](2026-08-14-git-worktree-tools.zh.md)

## Problem

A coding agent needs to isolate a piece of speculative work from the main working tree: create a git worktree on its own branch, work there, and later keep or discard it. Claude Code ships `EnterWorktree` / `ExitWorktree` tools for this; DeepSeek Harness had no in-harness equivalent. The blocker to a faithful port is the session working directory: in this harness `session.header.cwd` is a `readonly`, storage-owned field frozen at session creation (kept out of the event log by design), so a tool cannot mutate the session cwd mid-session the way the reference's `process.chdir`+`setCwd` does. Every model shell/fs call re-reads that immutable header for its default workdir.

## Decision

Ship `@deepseek-ai/dsh-tool-git-worktree` (package `packages/workspace/tool-git-worktree`), a pair of model tools that run all git through the `ctx.shell` seam (`resolve` then `run`, never a direct spawn) and validate every on-disk path stays inside the repository through `ctx.fs`. All git command construction is centralized in one module (`src/worktree.ts`) as opaque `{ command, workdir, label }` values, so a future pure-JS git backend replaces one module, not every call site.

- **EnterWorktree** takes an optional `name` (a random `adjective-noun-suffix` slug otherwise), locates the repo root from the agent's session cwd via `git rev-parse --show-toplevel`, builds a `worktree-<name>` branch from HEAD, and runs `git worktree add -B`. Outside a git working tree it returns a structured error instead of changing anything.
- **ExitWorktree** takes `action` (`keep`/`remove`) and optional `discard_changes`. `keep` clears the session and returns to the original cwd without touching the tree. `remove` first probes `git status --porcelain` and `git rev-list --count <base>..HEAD` and **fails closed** — an unverifiable state, uncommitted files, or new commits refuse removal unless `discard_changes` is explicitly `true`, with the evidence listed.
- Both tools are `isConcurrencySafe = () => false`. The active worktree session is a process-wide singleton mirroring the claude-code reference.

### The cwd-switch mechanism

Because a true session-cwd mutation is impossible (`session.header.cwd` is `readonly` and storage-owned), the worktree switch is expressed two ways that are safe given the immutable session cwd:

1. A `tool:worktree:cwd` `ctx.systemPrompt` runtime context, registered at plugin apply, reports the active worktree path as the current working directory when one is active (and contributes nothing otherwise). As a durable model-visible runtime fact it satisfies the "model-visible ⟺ logged" contract.
2. The `EnterWorktree` result declares the new working directory and instructs the model to pass `workdir` equal to the reported `worktreePath` on subsequent shell and fs calls (the bash/fs tools resolve that `workdir` per call, so explicit paths land in the worktree even though the default is pinned).

This is the harness's seam-supported substitute for the reference's ambient cwd switch, recorded here because the next engineer will reasonably ask why the worktree isn't a real cwd.

### Destructiveness, without an `isDestructive` field

`dsh-tools`' `defineTool` has no `isDestructive` field (only `isConcurrencySafe`), so `ExitWorktree(remove)` destructiveness is expressed in the permission-friendly human-readable description and in the `presentCall` distinct `remove` vs `keep` card. This is the closest the harness adhesion layer offers; a future `isDestructive` addition would lift it out of prose.

## Alternatives considered

- **Mutate `session.header.cwd` to point at the worktree.** The header is `readonly` and deep-frozen, explicitly a storage concern kept out of the event log; rewriting it in-session would corrupt persistence identity and is unsupported. Rejected.
- **A dedicated session-level cwd-override service** (a per-session mutable "active cwd" both `tool-bash` and `tool-fs` consult ahead of `header.cwd`). This is the "right" long-term shape and the exact reason the reference works, but it changes `tool-bash`/`tool-fs` — a cross-package behavioral change out of scope for a first capability package, with re-persisting and replay implications for the session log. Deferred; the worktree cwd injection keeps the switch model-visible today.
- **Sponsor `isDestructive` in `dsh-tools`.** Expedient but ownership of tool-semantics lives in `core/tools`; the description-plus-presentation approach ships the safety signal without a core change. Rejected for this PR.

## Consequences

- The worktree is created and removed reliably on real git, and the remove gate protects uncommitted/unmerged work (fail-closed on every probe failure — a silent 0/0 can never destroy work).
- Model-visible cwd facts reflect the worktree through the runtime context and result message, but subsequent shell/fs calls must pass `workdir`; the bash/fs tools do not inherit the worktree as their default. This is the documented limitation the mechanism buys correctness for.
- One process holds at most one active worktree (singleton state), matching the reference; multi-session isolation in a single process is not modeled and would need a per-session key if required later.
- A future pure-JS git backend swaps `src/worktree.ts`; a future `isDestructive` lift and a session-cwd override are natural follow-ups, each cross-referencing this note.
- Conventionally the CI per-file coverage gate is not yet met on the error/defensive branches of `index.ts` (the `gitFailure` fallbacks, the `assertPathInRepo` escape branch, and the abort path); the package tests cover the lifecycle, safety, and presentation paths and typecheck clean.
