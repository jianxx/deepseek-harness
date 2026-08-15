# memory/ — 持久化记忆

中文 | [English](README.md)

面向模型可见的基于文件的记忆，采用 Claude Code memdir 风格：持久的主题文件、
始终加载的索引、subagent side-query 召回，以及带三重门整合重写的后台轮末抽取。

| Package | 角色 | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Memdir 格式与解析器、`memory` 系统提示词 section、动态召回 | — |
| [`memory-consolidation/`](memory-consolidation/README.md) | 轮末抽取 + 三重门 dream 重写 | — |

[memory 系统设计](../../.agents/notes/implemented/feature/2026-08-14-memory-system.md) 注释记录了家族设计及其与 Claude Code 参考实现的差异。
