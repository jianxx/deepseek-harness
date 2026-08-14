# AGENTS.md

DeepSeek Harness is a plugin-based agent harness on vendored Cordis: **everything is a plugin**. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`; follow [docs/AGENTS.md](docs/AGENTS.md) for documentation.

## Orchestration workflow

You (Fable) are the orchestrator: plan, decompose, synthesize. Context is the scarcest resource: delegate reading + mechanical execution; subagents return distilled conclusions, not file dumps to relay ([rationale](.agents/notes/implemented/process/2026-08-14-orchestration-workflow.md)).

- **Routing**: reasoning-heavy work (design, plan review, root-cause, ambiguous verdicts) → deep-reasoner (Opus); mechanical execution of approved plans → fast-worker (Sonnet); Codex (`/codex:rescue --background`) is a peer engineer, not a reviewer.
- **Plan-first**: EnterPlanMode before features, >2–3-file changes, multiple viable approaches, or refactor/migration/deletion. The plan names files, changes, order, verification — the goal: one-pass implementation. Before ExitPlanMode, deep-reasoner reviews the plan cold as a Staff Engineer. Plan verification identically: you define observable pass criteria and drivers, fast-worker executes, deep-reasoner judges ambiguity.
- **High-stakes decisions** (architecture, data model, deleting subsystems, public API shape): task deep-reasoner AND Codex on the same problem in parallel, blind to each other. Agreement proceeds; disagreement IS the finding — resolve the divergence before deciding.
- **Execution and recovery**: decompose plans into mechanical units → fast-worker; stay at the synthesis layer. Return to plan mode after two failed fixes on one problem, when reality contradicts a plan assumption, or when scope exceeds the plan; never patch on top of a broken plan; route non-obvious root-cause to deep-reasoner.

A Stop hook (`scripts/check-subagent-paste.mjs`, registered in `.claude/settings.local.json`) flags suspected wholesale subagent pastes; opt out via that entry or `"disableAllHooks": true`.

A worktree checkout contains only tracked files: gitignored node_modules/ is absent and pnpm commands fail with module-not-found. Before the first pnpm command there, run `bash scripts/link-worktree-deps.sh` once — idempotent symlinks of every node_modules from the main checkout, a safe no-op outside worktrees. dist/ is unneeded: tsconfig `paths` and vitest resolve workspace specifiers to source.

## Pre-release stance: foundation over blast radius

**Remove this section at the first tagged release.** With no external consumers, prefer the correct foundation over compatibility shims: rename or repackage freely and update every reference together. Backends reject old on-disk formats. SQLite uses monotonic `SCHEMA_VERSION`; `dsh-session` keeps `SESSION_FORMAT_VERSION` at `0` with no compatibility promise.

## Repository layout

```
vendor/      Vendored Cordis source (manifest + sync: vendor/README.md)
packages/    @deepseek-ai/dsh-<pkg> workspaces at packages/<group>/<pkg>/
  core/        product API spine: session, system-prompt, tools, agent, agent-loop
  api/         Remote BFF assembly and Typert RPC gateway
  typert/      type graph generator, loader, runtime registry
  llm/         LLM capability: Service Definition/Consumer + DeepSeek providers
  e2b/         E2B POC: sandbox + FS/subprocess adapters
  shell/       bash capability: Service Definition + local/pwsh providers + Consumers
  subprocess/  subprocess capability + local process-tree provider
  terminal/    persistent sessions
  fs/          filesystem capability + policy
  lsp/         language-server capability
  skill/       skill provider registry + local impl + catalog/loader tool
  web/         web capability: Service Definition + search/fetch providers + tool Consumer
  compaction/  compaction capability + basic provider
  context/     request-context plugins
  subagent/    subagent capability: Service Definition + providers + delegation Consumers
  bundle/      installable dsh --profile patch-layer bundles
  workflow/    workflow capability + worker-thread provider + tool Consumer
  todo/        todo_write tool
  plan/        plan mode as logged state
  preset/      per-session agent composition from preset cordis.yml files
  guard/       loop-hygiene + tool-timeout plugins
  self-modification/  the agent inspects/mounts its own plugins
  hooks/       Claude Code/Codex hook bridges + wire-protocol library
  session/     durable session data: persistence, projection, titles, telemetry
  identity/    anonymous identity
  settings/    user-settings capability + file provider
  credentials/ credential-reference capability + env/.env provider
  acp/         automation-only Agent Client Protocol server
  interaction/ approval/interaction capabilities, permission, commands, ask-user
  boot/        shared app-bin glue
  sdk/         JSON-RPC protocol, server, TypeScript client
  examples/    demo bundles (agent-spine + CLI/ACP/JSON-RPC bins)
  support/     dev/test infrastructure
  util/        zero-dependency utilities
python/      Python SDK + bundled runtime (python/README.md)
native/      @deepseek-ai/node-addon-landlock-run source of record (native/README.md)
examples/    Runnable cordis.yml leaves over packages/examples bundles (examples/AGENTS.md)
.agents/     Agent workflows + Agent Notes (notes/)
docs/        architecture, generated catalogs, postmortems, cookbook (docs/AGENTS.md)
scripts/     repo gates and generators
website/     VitePress projection of selected bilingual docs/ sources
```

Package groups: [packages/README.md](packages/README.md).

## Commands

```sh
pnpm install            # pnpm workspaces, node ^22.19 || >=24
pnpm run clean          # remove build outputs and deleted-package residue
pnpm run test           # vitest unit tests
pnpm run test:coverage  # CI coverage gate: per-file 100% on packages/*/*/src
pnpm run test:e2e       # real-API tests; self-skip without a key
pnpm run test:snapshot  # keyless ACP/headless replay vs expected outputs (-t <name> to filter)
pnpm run test:snapshot:record  # re-record expected outputs (needs key)
pnpm run typecheck
pnpm run lint
pnpm run duplication    # cross-file TypeScript clone detection
pnpm run build          # tsc emits lib/types, tsdown bundles runtime
pnpm run hygiene        # knip + publint + workspace constraints + NodeNext consumer check
pnpm run check:windows-wine  # ONLY for a known Windows failure (needs wine); CI owns this signal
pnpm run doc-sync       # all documentation gates; leaf list in scripts/run-gates.ts
pnpm run website:build  # VitePress build (doubles as dead-link check)
pnpm dsh --profile headless "task"  # run one task from source (needs key)
pnpm run demo:cordis    # the agent modifies its own runtime (needs key)
pnpm run demo:acp       # ACP automation server (needs key)
```

### Host sandbox failures

When `gh`/`pnpm`/build/test/generator commands fail because the agent sandbox blocks credentials, network, IPC, file watching, or nested `sandbox-exec`, retry unchanged with the narrowest host escalation; require sandbox evidence — never bypass genuine test failures or the product sandbox under test.

### Run relevant checks locally

Run checks before pushes via [dsh-pre-push-checks](.agents/skills/dsh-pre-push-checks/SKILL.md); report only commands run. Match evidence to the surface: focused tests for behavior, snapshots for model/user output, `doc-sync` for docs, build/hygiene + built smokes for published paths, real-API e2e for provider behavior. CI owns exhaustive coverage and the platform matrix; rehearse everything locally only by explicit request, CI diagnosis, or irreducibly repository-wide changes. `test:coverage`, not `test`, is the CI coverage gate ([why](docs/testing.md)). After `gh stack sync`, validate immediately; do not merge before checks pass.

## Secrets / .env

Real-API tests and demos read `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL`, root `.env`. cordis.yml allows `!!js` (never `!js`) under plugin `config` and entry `disabled`; other metadata stays literal ([primer](docs/cordis-primer.md#loader-configuration)). Never commit credentials. CI e2e skips without a key; [testing.md](docs/testing.md) owns key policy.

## Conventions

- Every npm package is `@deepseek-ai/dsh-<name>`; vendored packages are rescoped ([mapping](docs/rescope.md)) and `private: true`. `@deepseek-ai/cordis` is a peerDependency (+ dev) of every harness package.
- ESM everywhere (`"type": "module"`). Use package names across packages and `.ts` in local relative imports. Config subprocesses run built `lib/` under plain Node; source regressions use their declared launcher ([testing policy](docs/testing.md#test-subprocess-launch-modes)). The `dsh` CLI source launch uses tsx's ESM-only hook (`node --import tsx/esm`); reachable modules stay ESM — Node's native TS modes don't cover the engines range ([contract](.agents/notes/implemented/architecture/2026-07-29-dsh-source-launch-tsx-esm.md)). Raw/Web `cordis.yml` bare plugins must appear in their resolver manifest's `dependencies`; `verify-cordis-config` enforces.
- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.
- **Runtime invariants assert owned relationships.** Check authoritative event streams or mutable data, not service/method presence, plugin metadata or effects, or fixed pure examples; otherwise an explained empty companion is correct ([rules](packages/AGENTS.md)).
- **Typed events use declaration merging** and merge-extensible maps. Event JSDoc needs `@mode` and payload `@param`; scoped keys absent from payloads need `@dshScopeScan unsupported`. Public service methods document parameters and non-void returns. `SessionEventMap` members are required-on-read by default — builds that do not know the type refuse the log unless the event carries `ignorable: true`; only structural format changes bump `SESSION_FORMAT_VERSION` ([mechanism](.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)).
- **Switch on discriminant tags.** Closed unions end in `assertNever`; merge-extensible unions fall through a documented default.
- **Waterfall listeners MUST call `next()`** to delegate; returning without it short-circuits the chain ([semantics](docs/cordis-primer.md#cordis-waterfall-semantics)).
- **Model-visible ⟺ logged**: anything reaching a model request must be reconstructable from the session log; a new model-visible input requires a session event.
- **Plugins, not loop changes**: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md.
- **A capability seam comprises Service Definition / Service Provider / Consumer roles.** Complete, never one role; split only when roles evolve independently ([glossary](docs/glossary.md#capability-seam)).
- **Prefer maintained dependencies over hand-rolling** when they genuinely delete owned code and tests ([policy](.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)).
- **Explicit > implicit at package boundaries**: defaulting is an explicit `resolve(request): Spec` step in the owning implementation, never a hidden `?? default` inside `run()` (the `dsh-shell` request/spec split is the template).
- **No hardcoded tunables in plugins**: deployment-varying choices are validated `Config` fields changeable from cordis.yml; a `DEFAULT_*` constant or test hook is not configurability. Protocol constants, external specs, security invariants stay fixed.
- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent.
- **Opaque cross-boundary ids are branded** (`Branded<B>` from `dsh-brand`), never bare `string`.
- **Trust TypeScript at typed same-process boundaries.** No runtime validation, fallbacks, or hostile-input tests solely for values the static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, or wire boundaries.
- **Source plane vs artifact plane, never mixed.** Static gates and tests resolve workspace imports through tsconfig `paths` to `src` on a clean tree; gates consuming built `lib/` declare that dependency ([layout](docs/development.md#typescript-project-layout)).
- **Keep compiler faces explicit.** Each package uses one aggregate except `api/remotes`; repo-wide programs seed a face config, never the root solution ([layout](docs/development.md#typescript-project-layout)).
- **An empty `catch` names what it swallows** and why nothing else can reach it; keep the `try` to one statement.
- Do not comment on facts obvious from code.
- **Prefer symmetry for parallel values**; unexplained asymmetry signals a missed extraction.
- **Tests describe behavior, not correctness.** Change obsolete behavior with its tests; explain why in the PR.
- **Non-trivial changes MUST include an Agent Note in the same PR;** only mechanical/local edits are exempt ([scope](.agents/notes/README.md#when-to-write-one)). Archived notes are frozen: never edit or cite them as current authority ([archive policy](.agents/notes/README.md#archiving-and-deletion)).
- **Testing policy** ([docs/testing.md](docs/testing.md)). Every non-trivial model- or product-user-visible behavior change adds or updates a keyless snapshot via a real runnable example in the same PR; package tests, e2e-only assertions, or mock-only fixtures do not substitute for the assembled application transcript. Fixtures must replay on macOS/Linux; fix fixtures, not normalizers.
- **A tool's UI render intent is part of its design**, decided up front (`generic`/`terminal`/`diff`, `locations`); presentation methods are pure functions of `args` ([cookbook](docs/cookbook/adding-a-tool.md)).
- **Plan unit, e2e, and snapshot coverage** for capability seams, lifecycle paths, and transcript output; add missing snapshot-harness support in the same change.
- **Choose PR history deliberately.** Split independent changes; fix the introducing PR before propagation. Standalone PRs and official stacks may merge-forward or rebase after review. Rewrites use `--force-with-lease`, abort on remote movement, never raw `--force`; an in-progress merge-forward checkpoints before taking a newer base ([rationale](.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md)).
- **Labels:** one `kind/*` per PR, all material `area/*`, native Issue Type ([taxonomy](.agents/notes/implemented/process/2026-08-08-unified-github-label-taxonomy.md)).
- TODO markers: `FIXME`/`TODO`/`XXX` by urgency ([semantics](docs/development.md)).
- Files end with exactly one trailing newline; `git diff --cached --check` (pre-commit) gates it.

## Defensive patterns

Read [docs/defensive-patterns.md](docs/defensive-patterns.md) before lifecycle, concurrency, subprocess, or teardown work.

## Type safety and documentation

Everything compiles under `strict: true` with `noImplicitAny`; every remaining `any` explains why narrowing is infeasible. Every module and export has concise JSDoc for its non-obvious contract; function-like exports include `@param`/`@returns` (`verify-export-jsdoc` enforces). Heritage-declared members, plugin-protocol slots, and constructors keep docs at the declaring Service Definition, protocol, or class.

Comments and docs state complete contracts and context, not reasoning transcripts. Use direct, concrete terms; no metaphors. Before writing `contract`, `boundary`, or `shape`, ask whether a more exact term names the subject: `response fields`, `JSON validation`, or `ESM exports` — not `response shape`, `validation boundary`, or `module shape`. Keep `contract` for obligations callers, callees, implementers, providers, producers, or consumers rely on (preconditions, postconditions, invariants, compatibility promises), and a literal process, wire, security, transaction, or lifecycle boundary. Do not narrate control flow or tests, preserve review history, or restate code. Keep behavior, failure, timing, ownership, safe-use facts; link the rationale. Use [dsh-prose-standard](.agents/skills/dsh-prose-standard/SKILL.md) for decisions. Wire mechanically checkable invariants into an executed top-level gate and prove each changed acceptance path rejects an invalid case. Use narrow, justified exceptions instead of disabling a rule globally.

Docs accompany every code change: update affected README/JSDoc contracts together. Routine bilingual work follows [docs/AGENTS.md](docs/AGENTS.md); only explicit user invocation may run `dsh-translate-docs`. Current-state prose, one physical line per paragraph, one home per fact, and word budgets live there.

## Editing these instructions

`CLAUDE.md` symlinks `AGENTS.md` at root, `packages/`, `examples/`; edit the real file. Keep each rule self-contained, linking high-level docs. Condense when clarity survives; raise a `verify-doc-budgets` ceiling when content genuinely needs the space. Edits to this file or agent contracts (`.claude/agents/`) are prompt changes: commit messages state the expected behavior change, verified in a later real session; no observation, no claim.

## Vendoring policy

`vendor/` packages are pinned source copies (manifest with upstream SHAs in [vendor/README.md](vendor/README.md)). Update via the sync procedure there; re-apply or retire logged local modifications; rerun `pnpm run test && pnpm run build`.
