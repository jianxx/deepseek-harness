# Agent Note: cc-plugin-loader

Status: implemented

English | [中文](2026-08-14-cc-plugin-loader.zh.md)

## Problem

Claude Code ships installable plugins whose `plugin.json` manifests declare commands, agents, skills, hooks, MCP servers, and settings. A DeepSeek Harness deployment that wants to reuse such a plugin has no bridge: each component is authored against Claude Code semantics and there is no in-memory mount that translates them onto the harness's seams (`ctx.commands`, `ctx.subagents`, `ctx.skills`, the hooks bridge, an MCP registry, `ctx.settings`) and reports what actually loaded.

## Decision

Add `@deepseek-ai/dsh-cc-plugin-loader` (packages/compat/cc-plugin-loader): a compatibility loader that reads a CC `plugin.json` manifest subset, translates each component with the pure helpers from `@deepseek-ai/dsh-skill-claude-code` and `@deepseek-ai/dsh-claude-code-agents`, and mounts it onto the host seam for that component via `ctx.get(...)`. Every mount is a Cordis effect so disabling the plugin recalls all of it.

Component mounts (each reported loaded/skipped/failed): `commands` (manifest inline or source → `register`), `agents` (`agents/` dir or manifest paths → registers an `AgentDefinition`-backed provider via `registerProvider`), `skills` (`skills/` dir or manifest paths → `discoverCcSkills` + `register` a runtime skill), `hooks` (`hooks/hooks.json` or inline → `mergePluginHooks`), `mcpServers` (inline record or `.mcp.json` → `registerServer`), and `settings` (allowlist-filtered, currently `agent`, → `set`).

The loader is peer-style: it probes each host seam and reports the component `skipped` (never failing the whole load) when the seam is absent. The manifest itself fails loud — a malformed manifest throws at load with the plugin name. `hooks` and `mcp` have no harness-owned service today, so those components report skipped unless a deployment supplies a guest seam.

The skill mount is also the consumer of `skill-claude-code`'s semantic metadata: `skillToolRestriction`/`applySkillRestriction` turn `allowed-tools` into a scoped `tools.restrict()`, `resolveSkillExecution` routes `context: fork` and downgrades to inline when the subagent seam is absent (reported), `registerSkillPathActivator` wires `paths` conditional activation, and `activationFor` reports whether inline shell is forbidden (a `shell: false` skill). `mountCcPlugin` returns `{ report, dispose }` — the per-component report for a host UI and a disposer that recalls every mount (a context teardown calls it automatically).

Deliberately left out of the loader: the manifest schema is a focused subset (name/version/description/author plus the six component fields), validated by hand for precise "throw with the plugin name" errors rather than driving a full schemastery config — unknown top-level fields are ignored, matching Claude Code. Agent providers forward `start` to a named backend (default `fork`) rather than re-implementing the agent loop, so executing a loaded CC agent still needs a `fork` backend on the subagent seam.

## Verification

Vitest runs five suites (54 tests) against temporary-directory fixtures and fake seams: manifest parse errors (missing/space name, command source/content exclusivity, invalid shapes), each component's mount/skip/report, effect disposal (recalling every mounted component), `allowed-tools` restriction wiring, `context: fork` downgrade, and `paths` activation. Package `tsc --build` (exit 0) and the base regression (`skill-claude-code` + `claude-code-agents`, 81 tests) stay green.

## Alternatives considered

**Transfer the hooks/mcp/settings translation into the harness-owned packages themselves.** Rejected because each seam is a server-side concern with no single owner; centralizing all of it in one compatibility loader keeps the foreign-format mapping together and each harness package unchanged.

**Let a missing host seam fail the whole load.** Rejected because the manifest is the only part a deployment fully controls; a missing optional seam (especially the guest `hooks`/`mcp` ones) should degrade to a reported skip, not a whole-plugin failure.

**Drive the manifest validation through a schemastery Config.** Rejected because the manifest is a cross-package compatibility format with union shapes (path / list / object map) and tolerant top-level handling; a hand-rolled validator gives precise, testable failures and avoids depending on a config schema for what is really a parser boundary.

## Consequences

Any Claude Code plugin directory with a `plugin.json` is now mountable by the harness with no manifest rewrite. A host UI can present the per-component report, and disabling the plugin recalls every mount. The trade-off is that the `hooks`, `mcp`, and `settings` components depend on guest seams the harness does not yet ship, so those report skipped by default until a deployment provides them, and agent execution requires a `fork` backend at run time.
