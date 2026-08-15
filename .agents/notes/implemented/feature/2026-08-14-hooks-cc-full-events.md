# Agent Note: CC hooks bridge non-command executor kinds + http executor

Status: implemented

## Problem

The Claude Code hooks bridge (`@deepseek-ai/dsh-hooks-claude-code`) and the shared
protocol lib (`@deepseek-ai/dsh-hook-protocol`) only recognized and ran the
`command` executor kind. A user's `hooks.json` commonly mixes `command`, `prompt`,
`http`, and `agent` hooks; the bridge parsed the three non-command kinds only to
skip them with a warning. `http` hooks — which need no model — should actually run,
and the executors should share the protocol's dialect-neutral vocabulary and
exit-code/output contract rather than being conflated with command hooks.

## Decision

- **`dsh-hook-protocol` owns the four-kind vocabulary and the http executor.**
  `src/types.ts` declares `HookCommand = CommandHook | PromptHook | HttpHook |
  AgentHook`, so the codec/merge stay kind-agnostic and the bridges share the
  dialect-neutral shape. `src/http.ts` adds `runHttpHook`, which POSTs the hook
  input JSON and maps the HTTP response onto the same exit-code contract as command
  hooks (200 → 0, a 200 body parsed as structured stdout so a
  `permissionDecision:deny` body blocks, any other status → a non-blocking "exit").
  Header values interpolate `$VAR`/`${VAR}` but only names in `allowedEnvVars`
  resolve (others become empty strings — the exfiltration guard) and results are
  stripped of CR/LF/NUL (header injection). `allowedHttpHookUrls` restricts
  destinations. `runHttpHook` never throws: an allowlist violation or request
  failure is a non-blocking `HookOutput` with `exitCode: undefined`.

- **The CC config parser accepts all four kinds** (`hooks-claude-code/src/config.ts`),
  carrying per-kind wire fields (`prompt`-`model`, `http`-`url`/`headers`/
  `allowedEnvVars`, `agent`-`prompt`/`model`) plus the shared `timeoutSec`.

- **The bridge dispatches by `type`** (`hooks-claude-code/src/index.ts`): a
  `dispatchHook` helper routes `command` → `runHook`, `http` → `runHttpHook`
  (policy from new `allowedHttpHookUrls` / `httpAllowedEnvVars` config), and
  `prompt`/`agent` → a warned no-op (parsed but not yet run). `http` header policy
  is read from Config, not hard-coded.

- **URL-allowlist semantics collapse "unset" and "[]".** Claude Code treats
  `allowedHttpHookUrls: undefined` as unrestricted and `[]` as block-all. This
  bridge's config field passes through schemastery, which materializes an unset
  optional array as `[]`, so we cannot distinguish them. We chose **absent/empty =
  unrestricted**, only a non-empty array restricts. This is the safe default: an
  unset policy can never silently block every `http` hook, and it avoids an
  engineering escape hatch against schemastery.

## Alternatives considered

- Keep skipping all non-command hooks (the status quo). Rejected: `http` hooks are
  purely mechanical (no model) and a user config that uses them should work.
- Add the three executors to the bridge only. Rejected: the vocabulary, exit-code
  mapping, and http policy are dialect-neutral and belong in `dsh-hook-protocol`
  beside `runHook`.
- Distinguish `undefined` from `[]` in the URL allowlist to match CC exactly (block
  on `[]`). Rejected: schemastery cannot represent the distinction; the engineering
  cost exceeds the value, and the safe default favors running hooks.

## Consequences

- `http` hooks in a user's CC config now execute and can block/deny on an
  extension point. Prompt and agent hooks are surfaced (warned) but still do not
  run — running them requires `ctx.llm`/`ctx.subagents` wiring (deferred).
- The event-mapping expansion (wiring more CC events — `PermissionRequest`,
  `PreCompact`, `PostCompact`, `SessionEnd`, etc.) is explicitly NOT part of this
  change; the bridge still maps the original seven events. This change is the
  executor-kind + http foundation that work rests on.
- Coverage: per-file 100% on `packages/hooks/hook-protocol/src/http.ts`,
  `packages/hooks/hooks-claude-code/src/config.ts`, and
  `packages/hooks/hooks-claude-code/src/index.ts`, exercised via real local mock
  HTTP servers and the full agent loop.
