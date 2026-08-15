# Agent Note: claude-code-agents loader

Status: implemented

English | [中文](2026-08-14-claude-code-agents-loader.zh.md)

## Problem

A DeepSeek Harness deployment that wants to reuse an author's existing Claude Code sub-agent catalog has no bridge: `.claude/agents/*.md` and `*.json` definitions carry Claude Code semantics (frontmatter fields, markdown body as system prompt, tool allow/deny lists), and the harness consumes agent behavior through its own preset and subagent vocabulary. Without a translation step, either the author rewrites every agent by hand or the catalog stays unusable.

## Decision

`@deepseek-ai/dsh-claude-code-agents` (packages/preset/claude-code-agents) loads Claude Code agent files as dsh agent presets through a pure, filesystem-backed loader. `loadClaudeCodeAgents(root, options?)` resolves the project layer by walking up from `root` for a `.claude/agents` directory and the user layer at `~/.claude/agents` (overridable via `options.userDir`), then parses every `.md` and `.json` file into one `AgentDefinition` each, with the project layer shadowing the user layer on a basename collision.

The translation is integration-free by design. The loader produces typed definitions and leaves consumption (a scoped `ctx.tools.restrict()`, a request rewrite, a permission selection) to a caller, so the model-facing parts stay reusable without dragging in the harness runtime. Fields map one-to-one: `description` becomes the when-to-use guide; `tools`/`disallowedTools` compile to a single `allow`/`deny` `ToolRestriction` whose names intersect (a name in both lists is denied — restrictions intersect in `dsh-tools`); `model` normalizes the `inherit` sentinel; `effort`, `permissionMode`, `maxTurns`, `initialPrompt`, `background`, `memory`, `skills`, `mcpServers`, `hooks`, and `isolation` are carried through. Unknown fields are ignored, so a definition authored against a newer Claude Code release degrades to the supported subset rather than failing. Any bad known value throws at load time with the file path and field name, keeping failures loud.

## Alternatives considered

- **Register into the subagent provider registry at load time.** The current `ctx.subagents` seam exposes providers (`spawn`/`fork`/`acp`) selected by a fixed provider name, not a name-selectable agent-type catalog, and `tool-subagent` has no `subagent_type` parameter a loaded agent could feed. This loader therefore stops at typed definitions and leaves that integration to a later consumer that owns the model-facing selection, rather than inventing a new selection surface inside a load-only package.
- **Emit an `agent.cordis.yml` preset file per agent.** Writing composition files would couple the loader to the preset serialization format and to the harness loader dialect. Returning `AgentDefinition` objects keeps the package a pure translation and lets each deployment mount them as it already mounts presets.
- **Silently skip agents that fail to parse.** Claude Code degrades a bad agent to a log and keeps the rest. For a harness preset this hides real authoring mistakes, so the loader throws on the first unparsable agent instead; discovery stays deterministic and a broken agent is fixed, not forgotten.

## Consequences

The loader adds a self-contained package with zero harness-runtime dependencies (only `js-yaml`), fully unit-tested at 100% per-file coverage. It does not yet wire loaded agents into the harness's model-facing subagent tool — that remains a separate integration that consumes `AgentDefinition[]`. The pure-function exports (`loadClaudeCodeAgents`, `parseAgentMarkdown`/`parseAgentJson`, `resolveToolRestriction`, `normalizeModel`) give that future plugin loader and this package's own tests the same reusable surface.
