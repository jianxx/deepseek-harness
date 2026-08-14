# Agent Note: claude-code-agents loader

Status: implemented

[English](2026-08-14-claude-code-agents-loader.md) | 中文

## Problem

一个希望复用作者既有的 Claude Code 子 agent 目录的 DeepSeek Harness 部署没有任何桥接：`.claude/agents/*.md` 与 `*.json` 定义携带 Claude Code 语义（frontmatter 字段、以 markdown 正文为系统提示、工具 allow/deny 列表），而 harness 通过自己的 preset 与 subagent 词表消费 agent 行为。缺少翻译步骤时，作者要么手工重写每个 agent，要么该目录依然不可用。

## Decision

`@deepseek-ai/dsh-claude-code-agents`（packages/preset/claude-code-agents）通过纯文件系统驱动的 loader 将 Claude Code agent 文件加载为 dsh agent preset。`loadClaudeCodeAgents(root, options?)` 从 `root` 向上遍历解析 project 层的 `.claude/agents` 目录，并从 `~/.claude/agents` 解析 user 层（可用 `options.userDir` 覆写），随后将每个 `.md` 与 `.json` 文件解析为一个 `AgentDefinition`，遇 basename 冲突时 project 层遮蔽 user 层。

该翻译层刻意与集成解耦。loader 产出类型化定义并将消费（作用域 `ctx.tools.restrict()`、请求改写、权限选择）交给调用方，因此模型侧各部分无需拖入 harness 运行时即可复用。字段一一映射：`description` 成为 when-to-use 指南；`tools`/`disallowedTools` 编译为单个 `allow`/`deny` 的 `ToolRestriction`，其名称求交集（同时出现在两个列表中的名称被禁用——`dsh-tools` 中的约束求交集）；`model` 归一化 `inherit` 哨兵；`effort`、`permissionMode`、`maxTurns`、`initialPrompt`、`background`、`memory`、`skills`、`mcpServers`、`hooks` 与 `isolation` 全部透传。未知字段被忽略，因此针对更新版本 Claude Code 编写的定义可降级到受支持子集而非失败。任何坏掉的已知值都会在加载期带着文件路径与字段名抛错，保持失败响亮。

## Alternatives considered

- **加载期注册进 subagent provider 注册表。** 当前 `ctx.subagents` 接缝暴露的是由固定 provider 名称选择的 provider（`spawn`/`fork`/`acp`），而非可按名称选择的 agent 类型目录，且 `tool-subagent` 没有可接收已加载 agent 的 `subagent_type` 参数。因此该 loader 止步于类型化定义，将该集成留给后续拥有模型侧选择的消费方，而不是在只做加载的包内发明新的选择表面。
- **为每个 agent 输出一个 `agent.cordis.yml` preset 文件。** 写组合文件会把 loader 耦合到 preset 序列化格式与 harness loader 方言。返回 `AgentDefinition` 对象则保持该包为纯翻译层，并让每个部署按既有方式装载它们。
- **静默跳过无法解析的 agent。** Claude Code 会把坏 agent 降级为一条日志并保留其余部分。对 harness preset 而言这会隐藏真实的编写错误，因此 loader 在第一个不可解析的 agent 处抛错；发现保持确定性，坏 agent 会被修复而非遗忘。

## Consequences

该 loader 新增了一个零 harness 运行时依赖（仅 `js-yaml`）的自包含包，以每个文件 100% 的覆盖率通过完整单元测试。它目前尚未把已加载 agent 接入 harness 的模型侧 subagent 工具——这仍是另一个消费 `AgentDefinition[]` 的独立集成。纯函数导出（`loadClaudeCodeAgents`、`parseAgentMarkdown`/`parseAgentJson`、`resolveToolRestriction`、`normalizeModel`）为未来的插件 loader 与本包的测试提供了同一个可复用表面。
