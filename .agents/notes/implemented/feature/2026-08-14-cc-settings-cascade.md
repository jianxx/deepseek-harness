# Agent Note: Claude Code-style settings cascade provider

Status: implemented

## Problem

The DeepSeek Harness user-settings seam ([`@deepseek-ai/dsh-settings`](../../../../packages/settings/settings/README.md)) resolves one raw user layer over schema defaults and a registrant `base`. Claude Code-shaped deployments compose settings across five sources with distinct merge rules — user, project, local, flag, and policy — plus permission-array denial semantics and a two-stage `env` application. The harness had no first-party provider that reproduces those semantics for `ctx.settings`.

## Decision

The harness publishes `@deepseek-ai/dsh-settings-cascade`, a read-only `ctx.settings` Provider. Five sources merge low-to-high (user < project < local < flag < policy) as raw documents; the merged per-namespace document feeds the existing seam, so namespace resolution still layers schema defaults, the registrant `base`, and the composed user layer. The provider is a pure composition: `writable` is `false`, and leaf writes stay with each namespace's file provider.

Merge semantics mirror Claude Code: plain objects recurse; permission arrays (`allow`/`deny`/`ask`) union across layers with `deny` winning over `allow`; other arrays override to the higher layer. Policy is first-source-wins over its sub-sources (remote > system file > user file). The top-level `env` section splits out and applies in two stages — `applyEnv` for ordinary variables, `applyTrustedEnv` (after user trust) for the fixed `DANGEROUS_ENV_VARS` set.

The Claude Code-compatible `permissions` schema (allow/deny/ask, defaultMode, disableBypassPermissionsMode, additionalDirectories) ships as an independent export for the permission-rule engine. Misconfiguration fails loud at load: an existing-but-invalid source document rejects plugin boot; absence contributes nothing.

## Verification

Package tests (vitest, 42 tests) cover five-level precedence over real temp-file documents, the plugin-default base, deny-union across sources, policy first-source-wins, two-stage `env`, bad-config load failure, and constitutional `permissions` schema parsing, plus deny-precedence merge units. A package-level `tsc --build` typechecks clean. Full-repo gates (doc-sync, coverage, hygiene) remain CI-owned.
