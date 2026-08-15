# compat/ — Claude Code 兼容家族

[English](README.md) | 中文

一个把为其他 agent 格式编写的工件加载进 harness 的兼容家族。这些包把外部格式翻译为 dsh 挂载，而不复制产生它们的运行时；它们是纯翻译器，外加（对插件加载器而言）consumer 侧的 seam 接线。

| 包 | 职责 | ctx key |
|---|---|---|
| [`cc-output-styles/`](cc-output-styles/README.md) | Claude Code 兼容的输出风格选择：內建 Explanatory/Learning 风格加自定义 `output-styles/*.md` 文件，经 settings 或 `/output-style` 切换 | `/output-style` 命令 + `cc:output-style` system-prompt section |
| [`cc-plugin-loader/`](cc-plugin-loader/README.md) | 加载 Claude Code `plugin.json` 清单并挂载其组件 | 探测 `ctx.skills` / `ctx.subagents` / `ctx.commands` / guest `ctx.hooks` / `ctx.mcp` / `ctx.settings` |

加载器构建在 `skill/skill-claude-code` 与 `preset/claude-code-agents` 的纯翻译器之上；每个组件的宿主 seam 都通过 `ctx.get(...)` 读取，缺失时报告为 skipped，因此部署可以在并非每个扩展点都存在的情况下挂载一个插件。
