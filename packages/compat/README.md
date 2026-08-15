# compat/ — Claude Code compatibility

English | [中文](README.zh.md)

Packages that reproduce Claude Code CLI behaviors on top of the DeepSeek Harness, so teams and tooling familiar with Claude Code can adopt the harness without abandoning those workflows. These are **compat** packages: they mirror external product conventions rather than introduce new harness surface.

| Package | Role | Surface |
|---|---|---|
| [`cc-output-styles/`](cc-output-styles/README.md) | Claude Code-compatible output style selection: built-in Explanatory/Learning styles plus custom `output-styles/*.md` files, switched through settings or `/output-style`. | `/output-style` command + `cc:output-style` system-prompt section |

Each compat row documents which Claude Code surface it mirrors and where its behavior intentionally diverges. Integration follows existing harness seams — prompt section providers, the settings seam, and the command registry — rather than changing the agent loop.
