# compat/：Claude Code 兼容

[English](README.md) | 中文

在 DeepSeek Harness 之上复刻 Claude Code CLI 行为的包，使熟悉 Claude Code 的团队与工具无需放弃既有工作流即可采用本 harness。这些是**兼容**包：它们镜像外部产品约定，而非引入新的 harness 表面。

| 包 | 职责 | 表面 |
|---|---|---|
| [`cc-output-styles/`](cc-output-styles/README.md) | 兼容 Claude Code 的输出风格选择：内建 Explanatory／Learning 风格，加上自定义 `output-styles/*.md` 文件，通过 settings 或 `/output-style` 切换。 | `/output-style` 命令 + `cc:output-style` 系统提示词 section |

每个 compat 行都记录了它所镜像的 Claude Code 表面，以及其行为有意分歧之处。集成沿用现有 harness seam——提示词 section 提供器、settings seam 与命令注册表——而不是改动 agent 主循环。
