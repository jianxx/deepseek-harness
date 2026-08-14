# Agent Note: Claude Code-style local slash command packages (batch)

Status: implemented

English | [中文](2026-08-14-cc-commands-batch.zh.md)

## Problem

Claude Code ships a family of local slash commands (`/cost`, `/export`, `/status`, `/stats`, `/doctor`) that answer from session state or environment without a model turn. DeepSeek Harness had a command registry (`ctx.commands`) and a session event model rich enough to power the same human UX, but the correspondences were not implemented. Each command also needs the repo's structural obligations: a package with the `command-<name>` convention, a `ctx.commands` registration, pure fold/format separation, a test suite, a bilingual README, and an invariant companion.

## Decision

Five packages, one per command, each a function plugin registering one global command on `ctx.commands` with `type=local` semantics — the handler runs without model dispatch and consumes no tokens:

- `packages/session/command-cost` — `/cost`: folds `assistant/message` usage against the latest `request/header` model route into per-model buckets and prices them against a deployment USD `modelTable` (per-MTok, from Config). A `'*'` entry is the wildcard default column.
- `packages/session/command-export` — `/export`: renders the session log to markdown (default) or lossless JSON and writes it through `ctx.fs` (resolve + writeText). `Config.defaultDir` is the fallback directory.
- `packages/session/command-stats` — `/stats`: folds turns, steps, message counts, tool-call distribution, and token totals from the durable log.
- `packages/interaction/command-status` — `/status`: shows current model (last `request/header`), permission preset (`ctx.permissionPresets` when mounted), session id, and working directory (`session.header.cwd ?? process.cwd()`). Each line is omitted when its source is absent.
- `packages/interaction/command-doctor` — `/doctor`: reports the package-manifest version, settings reachability (`ctx.get('settings')`), and each seam's mount status, enumerating LLM providers where `ctx.llm.listProviders()` is available.

### Shared conventions

- **Pure folds, pure format.** Each package keeps fold and render logic in a `src/<topic>.ts` module free of cordis imports (tested directly on constructed event sequences); `src/index.ts` only gathers and registers. The empty path returns a direct "no data yes/no" string instead of a zero-only table.
- **Flat schemastery Config, no nested optional objects.** A nested `z.object` for an absent optional field fails cordis's `~standard` config validation at plugin load (descents into the object when `commands` is mounted). The cost package avoids this with a flat `modelTable` array using a `'*'` wildcard entry, and drops the `z<Config>` generic (its mutable/nullable inferred schema fights `readonly` fields under `exactOptionalPropertyTypes`).
- **`request/header` payload is `{ header: { config }, reason }`**, not a bare config; `TokenUsage` is imported from `@deepseek-ai/dsh-llm` (not `dsh-session`, which omits it from its lib types).
- **Optional services via `ctx.get(name)`.** Status reads `permissionPresets` and doctor reads `llm`/`settings`/seam services through `ctx.get`, so an absent service degrades to an omitted line or `not mounted` rather than failing mount.
- **Test harness** mirrors `command-goal`: a real `SessionStore`+`CommandRuntime`+`AgentRegistry` context, a stub agent accepted by the registry, Loader `unwrapExports`+dispose checks, plus pure fold/format snapshots. `command-export` additionally mounts `fs-local` and writes to a temp dir.

### Lifecycle surface facts (from the service map)

- No `ctx.cwd`, `ctx.hooks`, or MCP mount registry exists. `/status` reads cwd from `session.header.cwd` and therefore has no MCP/hooks line to emit; `/doctor` reports each seam's presence but only `llm` exposes a public provider enumeration.
- There is no `ctx`-injectable version; `/doctor` mirrors `apps/cli`'s self-manifest read (`new URL('../package.json', import.meta.url)`), which every package shares at `0.1.0-rc.x`.
- Runtime invariant companions are empty (`apply` registers a no-op installer), consistent with `command-goal`/`command-compact`: these command adapters own no event stream, so the domain or registry checks elsewhere.

## Verification

- `vitest run` over the five packages: 5 files, 43 tests, all passing (normal path, empty path, and formatting snapshots per command; fold logic exercised on constructed session event sequences).
- Package-level `tsc -b` clean for all five. The repo's `test:coverage` gate (per-file 100%) was not run locally; CI owns coverage.
- Generated doc catalogs (`docs/module-graph.*`, `docs/config-catalog.*`) and `doc-sync` translation-pairing/prose gates were not run; the README pairs record their git-blob hashes but were not run through `verify-translation-pairing`.

## Future decision value

- The flat-config lesson (no nested optional `z.object` in a schemastery plugin Config; prefer wildcard entries) is the takeaway for any future configurable command package.
- `/cost` could later read the `sessionStats` projection for turnover wall times and `/doctor` could enumerate skill/web/lsp providers once those seams expose public provider lists.

## Alternatives considered

- **Single combined command** (one `/doctor`-style handler branching on a subcommand token) was rejected: the repo's `command-<name>` packaging convention and per-feature tests/READMEs favor one focused package per command, and a monolith would couple session folds (cost/stats/export) to environment reads (status/doctor) with no shared domain.
- **Folding through the `sessionStats` projection** for `/stats` was considered and set aside: the projection carries turn/step counts and wall times, but `/stats` also needs tool-call distribution and token totals that the projection does not expose, so a direct fold over the authoritative log is self-contained and testable without the projection carrier mounted.
- **A nested optional `defaultModelPrice` in Config** was rejected after load-time schema failures under cordis's `~standard` validation; the `'*'` wildcard column inside the flat `modelTable` array (plus dropping the `z<Config>` generic) sidesteps the schemastery edge case.

## Consequences

- Five self-contained packages with a uniform shape (pure fold + format, `ctx.commands` registration, invariant companion, bilingual README) that a consumer composes only when the capability is wanted.
- `/cost` and `/stats` duplicate a small amount of token-summing fold logic rather than sharing a wheel, so each stays independent and easy to read; the duplication is intentional and minor.
- Interface honesty: `/status` intentionally emits no MCP/hooks line and `/doctor` lists providers only for `llm`, because those registries do not yet exist publicly — the commands degrade rather than invent data.
- Config-driven pricing and export directories keep every tunable deployment-side instead of hardcoding it, at the cost of requiring consumers to supply `modelTable`/`defaultDir`.
