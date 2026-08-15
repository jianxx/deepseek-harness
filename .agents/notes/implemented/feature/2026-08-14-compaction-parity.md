# Agent Note: Model-free microcompaction as a compaction-family companion

Status: implemented

English | [中文](2026-08-14-compaction-parity.zh.md)

## Problem

Full summarization is expensive and model-gated: `dsh-compaction-basic` only summaries when pressure or overflow qualifies, and even then a single oversized retained unit may resist surface compaction. Yet much of what grows a long session is routine tool output the model no longer needs verbatim — an old `bash` transcript, an early `grep` page, a stale `web_fetch` body. Keeping every tool result at full fidelity until a summarizing pass runs wastes context that a cheaper, model-free transformation could reclaim earlier and more often.

Claude Code's compaction vocabulary splits this into two complementary strategies that are easy to conflate: *microcompact* collapses only the oldest tool results (by a retention window) into placeholders, while *reactive compact* and *threshold autocompact* run a summarizing pass. DeepSeek Harness already ships the reactive and threshold strategies inside `dsh-compaction-basic` (pressure at `agent/pre-step`, overflow at `agent/request-error`, both with a Config-tunable retry/circuit-breaker count), and a head/middle/tail content pruner (`dsh-compaction-tool-result-pruner`). What was missing was the **retention-window** strategy: identify old tool results by their tool-use id, drop them below the window, and keep the decision stable and reconstructable.

## Decision

Add **`@deepseek-ai/dsh-compaction-micro`** as a model-free companion in the compaction family (`ctx.microcompactor`), configured as a `Service` with `static Config`. It follows the same shape as `dsh-compaction-tool-result-pruner` and does **not** implement `CompactionEngine` — it is a strategy the backend or an explicit caller composes, not a second backend.

### Retention window by tool-use id

`microcompactSession(session)` snapshots the current-surface `tool/result` nodes in surface order and keeps the most recent `retainResults` verbatim. Every older result is eligible. Correlation is by `ToolResultMessage.source.callId` — the tool-use id the message carries — matching the `tool/call` ↔ `tool/result` pairing used across the loop. Each collapsed result is replaced by one newly appended `tool/result` with `{ surfaceOp: { op: 'replace', start, end }, sourceEventSeqs: [originalSeq] }`, spreading the complete original data and changing only `content` (preserving `turn`, `step`, `callId`, error fields, `meta`). The replacement is immediately preceded by a `compaction/prune` shadow-price event (mirroring the pruner's shared protocol) so a pure consumer subtracts the shadowed node's token price without per-node state.

### Placeholders reuse a cited spill locator

When the original text cites a spilled artifact (`… stored at: <locator>.`), the placeholder re-embeds that locator sentence so the model can still read the full result. `reuseSpillLocator(text)` extracts the first such sentence, and the placeholder carries it verbatim into the replacement event — so the locator is reconstructable from the log (model-visible ⟺ logged). It is documented as best-effort and matched to `dsh-tool-fs`-style `stored at:` phrasing; a tool that phrases locators differently will not have one re-embedded.

### Freeze: the decision is stable and the prompt stays byte-identical

A placeholder always begins with a fixed `MICROCOMPACT_MARKER`. A later pass recognizes an already-collapsed result by that marker and never re-decides it, so a repeated pass over unchanged history replaces nothing and emits a byte-identical prompt (`stable: true`). This preserves prompt-cache reuse across repeated pre-step invocations — re-running must not re-invalidate the cache.

### Durable decision record

Each replacement appends a `compaction/microcompact` session event (declaration-merged into `dsh-compaction`'s `SessionEventMap`, extending the existing vocabulary backward-compatibly) recording `originalSeq`, `replacementSeq`, `callId`, and the re-embedded `spillLocator`. Because the replacement content already carries the deterministic marker, the decision reconstructs from replay + code even without this event; the record makes the window and freeze policy readable by a pure consumer.

### Switchable, composable pipeline

`auto: true` registers an `agent/pre-step` hook that runs the microcompact pass before the turn's request, so `dsh-compaction-basic`'s summarizer reads an already window-reduced surface within its own pressure flow. `auto: false` (default) makes it an explicit call, keeping each companion independently switchable and composable with the pruner without coupling the packages.

## Alternatives considered

- **New compaction backend implementing `CompactionEngine`** — rejected: microcompact does no summarization and owns no `compactionId` lifecycle; it is a model-free transformation like the pruner. A full backend would overstate its role and force lock/bracket semantics that do not apply.
- **Fold microcompact into `dsh-compaction-basic`** — rejected: basic is the summarizing backend, and adding a separate retention-window strategy couples the two policies and their Config. The family pattern (one service per strategy) keeps them independently switchable and testable.
- **Summary (model) microcompact** — rejected: the whole point is to reclaim context without a model call; a placeholder plus preserved locator is cheaper and model-free, and a real summary is what `compaction-basic` already produces on pressure.
- **Durable memo only (no deterministic marker)** — rejected: a per-session in-memory decision set would not survive replay; tying freeze to a deterministic content marker makes the decision reconstructable from the log and code alone.

## Consequences

- **Packages**: `packages/compaction/compaction-micro` is a new Host package (registered in `tsconfig.host.json`) with a README triplet, an invariant companion mirroring the pruner's, and `compaction/microcompact` added to the `compaction` vocabulary.
- **`ctx.microcompactor`** joins `ctx.toolResultPruner` as an optional model-free companion; neither is required by `dsh-compaction-basic`.
- **Model-visible ⟺ logged** holds: the placeholder, the re-embedded locator, and the decision record are all durable session events reconstructable from the log.
- **Deferred**: a general, config-array-declared pipeline that orders every strategy (micro, prune, summary, reactive) in one shared harness is not built here; each companion keeps its own `auto` switch and the backend composes them explicitly. The reactive and threshold strategies already live in `dsh-compaction-basic` and are unchanged.

## Testing

Unit tests over a fake session event sequence pin the retention window (oldest beyond `retainResults` collapse, newest kept verbatim), freeze/idempotence (a second identical pass replaces nothing and leaves the surface byte-identical), decision-record reconstruction from the log, spill-locator re-embedding, config validation, and the invariant companion contract.
