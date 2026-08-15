# memory/ — persistent memory

English | [中文](README.zh.md)

File-based, model-visible memory in the style of Claude Code's memdir: durable
topic files, an always-loaded index, subagent-side-query recall, and background
turn-end extraction with a three-gate consolidation rewrite.

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Memdir format + parser, `memory` system-prompt section, dynamic recall | — |
| [`memory-consolidation/`](memory-consolidation/README.md) | Turn-end extraction + three-gate dream rewrite | — |

The [memory system design](../../.agents/notes/implemented/feature/2026-08-14-memory-system.md) note records the family design and its deviations from the Claude Code reference.
