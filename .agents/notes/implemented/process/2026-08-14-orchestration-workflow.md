# Agent Note: Orchestration workflow with routed subagents

Status: implemented

English | [中文](2026-08-14-orchestration-workflow.zh.md)

## Problem

This repository is built and maintained by agents, and the default agent shape — one model doing planning, execution, verification, and review in a single context — has three structural failure modes. Context is consumed by reading and relaying mechanical output that a delegate could hold instead, leaving less for synthesis. Reasoning-heavy phases (design, plan review, root-cause) and mechanical phases (bulk edits, check runs) run at the same model depth, paying Opus-class latency for Sonnet-class work or accepting Sonnet-class depth for Opus-class decisions. And without written review gates, plans ship unreviewed, failed fixes get patched on top of broken plans, and subagent output leaks into the final answer undistilled. Worktree-based sessions add a fourth, concrete failure: `git worktree` checkouts omit gitignored node_modules/, so every pnpm gate fails with module-not-found and each session re-diagnoses it.

## Decision

Root `AGENTS.md` gains an **Orchestration workflow** section making Fable the orchestrator: delegate reading and mechanical execution, keep the main context for synthesis. Routing is fixed: reasoning-heavy work goes to `deep-reasoner` (Opus), mechanical execution of approved plans to `fast-worker` (Sonnet), and Codex (`/codex:rescue --background`) is treated as a peer engineer. Plan-first edits require plan mode before features, >2–3-file changes, multiple-approach work, or refactor/migration/deletion, with a cold Staff-Engineer plan review by deep-reasoner before ExitPlanMode. Irreversible or expensive choices get a parallel blind review by deep-reasoner AND Codex, with disagreement treated as the finding. Failure recovery returns to plan mode after two failed fixes, a contradicted plan assumption, or scope overflow — never patching a broken plan.

Two committed agents carry the supported subagent side: `.claude/agents/deep-reasoner.md` (adversarial reviewer; returns Recommendation / Reasoning / Risks-unknowns) and `.claude/agents/fast-worker.md` (executes the spec exactly, stops and reports on spec discrepancy instead of improvising; returns Changed / Checked / Deviations / Blockers).

Two scripts back the section's normative references. `scripts/link-worktree-deps.sh` discovers every node_modules in the main checkout via `git rev-parse --git-common-dir` and symlinks each at the same relative path in a worktree — idempotent, and a no-op in the main checkout. `scripts/check-subagent-paste.mjs` is a Stop hook that flags suspected wholesale subagent-output pastes (a ≥40-line quoted or fenced block carrying an agent output-contract header pair), fail-closed on any malformed input; it emits a user-facing `systemMessage` by default and a blocking decision only under `SUBAGENT_PASTE_HOOK=block`, standing down while `stop_hook_active` to avoid the block-cap loop. Behavior is pinned by `scripts/check-subagent-paste.spec.ts` (nine subprocess cases). The hook registers in user-local `.claude/settings.local.json`, which `.gitignore` now covers.

`scripts/doc-budgets.manifest.json` raises the AGENTS.md ceiling 1900 → 2100, justified per docs/AGENTS.md ("raise when content would otherwise be deleted"): faithful compression of the new section (588 → 287 words) plus lossless tightening of existing prose (180 words) reaches a measured floor of 2100 with every pre-existing rule retained.

The "Edits to this file or agent contracts are prompt changes" rule moved into "Editing these instructions", scoped to both `AGENTS.md` and `.claude/agents/`: commit messages state the expected observable behavior change, verified in a later real session.

## Alternatives considered

**One generalist shape, delegation left ad-hoc.** Unwritten delegation rules drift per session, and there is no cost/latency control point: every phase runs at one model depth. The rejected shape is exactly what the routing table and review gates exist to prevent.

**Blocking paste hook by default.** A heuristic blocker interrupts legitimate long quotes (documentation excerpts, reviewer-requested transcripts). Default-to-signal with an opt-in `SUBAGENT_PASTE_HOOK=block` strict mode keeps the fail-closed, conservative stance: the detector requires a ≥40-line block AND a contract-header pair, preferring misses over false positives.

**Full `pnpm install` per worktree.** Minutes of install and duplicated disk per worktree, when pnpm's content-addressable store already makes symlinked node_modules equivalent. Discovery plus per-directory symlinks is instant and idempotent.

**Commit the hook registration.** `.claude/settings.local.json` is user-local by Claude Code convention and also holds local permission allow-lists; committing it would force one registration (and its permission entries) on every checkout. The file stays gitignored; AGENTS.md documents the hook, its location, and both opt-outs.

**Hold the 1900-word ceiling by deleting rules.** The remaining distance past lossless compression comes only from genuine rule text (testing exemplars, type-safety style rules, layout orientation). Deleting constitution content to fit a budget inverts the policy's priority; the ceiling raise carries this measurement as its justification.

## Consequences

Every session loads the workflow from `AGENTS.md`; routing, cold plan review, blind parallel review, and the failure-recovery triggers become standing practice, observable as the commit message states. `.claude/agents/*.md` become prompt-carrier files whose edits follow the prompt-change rule. The Stop hook is active only in checkouts whose local settings register it. AGENTS.md lands exactly at the 2100-word ceiling, so any future addition must condense first or carry its own ceiling justification.
