# compat/ — Claude Code compatibility family

English | [中文](README.zh.md)

A compatibility family that loads artifacts written for other agent formats into the harness. These packages translate foreign formats into dsh mounts without copying the runtime that produced them; they are the pure translators plus, for a plugin loader, the consumer-side seam wiring.

| Package | Role | ctx key |
|---|---|---|
| [`cc-plugin-loader/`](cc-plugin-loader/README.md) | Load a Claude Code `plugin.json` manifest and mount its components | probes `ctx.skills` / `ctx.subagents` / `ctx.commands` / guest `ctx.hooks` / `ctx.mcp` / `ctx.settings` |

The loader builds on the pure translators in `skill/skill-claude-code` and `preset/claude-code-agents`; each component's host seam is consulted via `ctx.get(...)` and reported skipped when absent, so a deployment can mount a plugin without every extension point present.
