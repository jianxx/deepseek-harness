# Agent Note: Claude Code-compatible permission rules

Status: implemented

English | [中文](2026-08-14-cc-permission-rules.zh.md)

## 问题

The harness has an approval seam (`ctx.approval`) and coarse permission presets, but no rule engine that maps Claude Code's `ToolName` / `ToolName(content)` permission syntax onto tool calls. Deployments could not express "allow npm install but ask on rm -rf", keep `.git` and shell-config writes immune to every mode, or hot-edit a ruleset through settings. Host UIs also had no pure, browser-safe way to preview what a rule would hit.

## 决策

**A new `@deepseek-ai/dsh-permission-rules` interaction package owns the engine.** It parses rules on the `tools/pre-execute` waterfall and enforces bypass-immune content rules through the monotonic `guard()` layer, reusing the existing approval seam rather than changing the loop.

**Rule syntax and matching follow Claude Code.** `ToolName` or `ToolName(content)`; content supports backslash paren-escapes, a `*` wildcard, and the legacy `:*` prefix form. Malformed rules throw a `TypeError` at load (fail loud), unlike Claude Code's silent tool-name fallback — the spec's explicit contract.

**Evaluation is a pure, exported function.** `evaluatePermission(input)` folds allow/deny/ask/passthrough in the spec order: bypass-immune → whole-tool deny → whole-tool ask (sandboxed-bash exempt) → content rules by source priority → mode (bypassPermissions/acceptEdits/plan) → whole-tool allow → passthrough. Bypass-immune matches deny even under `bypassPermissions`.

**Bypass-immune rules are authoritative monotonic guards.** The plugin registers them with `ctx.tools.guard()`, and the waterfall delegates (`next()`) instead of double-owning their denial, so no downstream listener or mode can flip them. `evaluatePermission` still reports them so host previews stay faithful.

**Rules come from Config and optional settings, merged by source priority.** Config `rules` parse with source `config`; an optional `permissions` settings namespace (`allow`/`deny`/`ask`/`defaultMode`) supplies higher-priority rules that hot-reload via `installSettingsSection`. Absent `ctx.settings`, Config alone works.

**Modes are resolved at call time.** Plan activation (via `foldPlanMode`) overlays a session's recorded `permission/mode`, falling back to `defaultMode`; `bypassPermissions` is disabled when configured so.

## Verification

- 66 tests across parser/evaluate/plugin/invariant suites, exercising escaping, wildcard/prefix matching, ordering, source priority, bypass-immune under bypassPermissions, acceptEdits/plan/bypass modes, hot reload, and fail-loud settings.
- Package-scoped `tsc --build` passes.
- Ran vitest via the local binary because the `pnpm` wrapper's deps check aborts on the new workspace package without a lockfile update (per worktree rules, `pnpm install` is forbidden).

## 影响

New public package `@deepseek-ai/dsh-permission-rules`; no agent-loop or existing extension points changed. Content extraction currently covers shell commands (`command`) and a single file path (`file_path`); wider tool-content coverage and persisted grant memory are deferred.
