# Agent Note: coordinator mode over continuable subagents

Status: implemented

English | [中文](2026-08-14-coordinator-mode.zh.md)

## Problem

DeepSeek Harness had no first-class "coordinate, don't edit" session posture. The pieces to build one existed — continuable subagents, `send_message`/`interrupt_agent`/`list_agents` controls, the `report` tool, scoped `tools.restrict()`, scoped prompt sections, and the subagent manager's `subagent-settled` completion wake — but no package activated a coordinator role that restricted the agent to delegation and read-only tools, explained that role in the system prompt, and surfaced model-facing scheduling tools under one mode.

## Decision

`@deepseek-ai/dsh-coordinator` (`packages/subagent/coordinator`) is an agent-scoped orchestration mode. Activation resolves `Config.enabled ?? DSH_COORDINATOR_MODE`; when inactive the package registers nothing, so a preset may mount it unconditionally. When active it requires an agent scope and installs, all scoped to that agent:

- the `coordinator:mode` prompt section (order 110) stating the delegation role, the scheduling-tool list, and the result-return protocol;
- the scheduling tools `spawn_worker`, `send_to_worker`, `worker_broadcast`, `worker_tasks` — thin adapters over `startContinuable`/`followup` and the live Agent registry, with a name↔child-id registry owned per install;
- a scoped `ctx.tools.restrict()` mask, default `{ deny: ['write', 'edit'] }`, Config-tunable through `restrict`.

`installCoordinatorMode(agent, ctx, config)` installs the registrations; `apply(ctx, config)` is the gating namespace-plugin seam a preset composes into an agent scope. Disposing the returned disposer (or the plugin fiber) reverses every registration, restoring the full tool surface.

Result return and completion are reused, not reimplemented. A worker reports via `tool-subagent-report`; when it settles, the subagent service's continuation settlement already injects its `subagent-settled` notice into the coordinator's session as a waking message. The coordinator package documents that reuse and does not duplicate the wake.

Mode durability across resume is delegated to composition: a preset pins the coordinator into the session's `agent.cordis.yml` composition, so re-mounting on resume reproduces restrict, section, and tools from the same config/env flag. No new session event type is added.

## Alternatives considered

- A global plugin that auto-masked every agent: rejected because `tools.restrict()` is an agent-scoped operation and masking every agent from a plain context is a deployment bug; activation therefore fails loud outside an agent scope.
- Reimplementing the completion wake as a coordinator-specific listener over `subagent/end`: rejected because the subagent manager already delivers `subagent-settled` completion notifications that wake the parent; the coordinator asserts and documents that reuse.
- Persisting the mode flag in a new durable session event: rejected; the existing config/env + preset pin mechanism reproduces the mode on resume without a new event type.

## Testing

`packages/subagent/coordinator/tests/coordinator.spec.ts` drives the mode under the agent-loop mock adapter and the in-process spawn provider, asserting: activation gating (Config and env), the write-tool restriction and its removal on dispose, the injected `coordinator:mode` section, an overridden `allow` mask, the no-op when disabled, re-activation reproducing the mode (resume), loud failure outside an agent scope, named `spawn_worker`/`send_to_worker`/`worker_broadcast`/`worker_tasks` routing, unknown-worker and agentless errors, the namespace export shape, and that a settled worker's `subagent-settled` notice reaches the coordinator session.

## Consequences

The coordinator role now composes out of existing subagent seams rather than new loop machinery, keeping `agent-loop` untouched (per the plugins-not-loop-changes convention). The default deny mask names the two canonical write tools and is Config-tunable, so deployments with differently named write tools configure `restrict` rather than being silently restricted. Because restrict only accepts names that exist as global tools, activating the default in a deployment without `write`/`edit` fails loud and loud failure is the intended contract.
