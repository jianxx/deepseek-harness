# Agent Note：cc-plugin-loader

状态：已实现

[English](2026-08-14-cc-plugin-loader.md) | 中文

## 问题

Claude Code 提供可安装插件，其 `plugin.json` 清单声明了命令、agents、skills、hooks、MCP 服务器与设置。想要复用这样一个插件的 DeepSeek Harness 部署缺少桥接：每个组件都基于 Claude Code 语义编写，没有一种内存挂载能把它翻译到 harness 的各个 seam（`ctx.commands`、`ctx.subagents`、`ctx.skills`、hooks 桥、MCP 注册表、`ctx.settings`）并报告实际加载了什么。

## 决策

新增 `@deepseek-ai/dsh-cc-plugin-loader`（packages/compat/cc-plugin-loader）：一个兼容性加载器，读取 CC `plugin.json` 清单子集，用 `@deepseek-ai/dsh-skill-claude-code` 与 `@deepseek-ai/dsh-claude-code-agents` 的纯函数翻译每个组件，并通过 `ctx.get(...)` 把它挂载到对应组件的宿主 seam。每次挂载都是一个 Cordis effect，因此禁用插件会完整回收全部挂载。

组件挂载（各自报告 loaded/skipped/failed）：`commands`（清单内联或 source → `register`）、`agents`（`agents/` 目录或清单路径 → 通过 `registerProvider` 注册一个由 `AgentDefinition` 支撑的 provider）、`skills`（`skills/` 目录或清单路径 → `discoverCcSkills` + `register` 一个运行时技能）、`hooks`（`hooks/hooks.json` 或内联 → `mergePluginHooks`）、`mcpServers`（内联记录或 `.mcp.json` → `registerServer`）、`settings`（allowlist 过滤，当前是 `agent`，→ `set`）。

加载器是 peer 风格：它探测每个宿主 seam，当 seam 缺失时把组件报告为 `skipped`（绝不让整个加载失败）。清单本身则 fails loud——格式错误的清单在加载时携带插件名抛错。`hooks` 与 `mcp` 目前没有 harness 自有的服务，因此除非部署提供 guest seam，否则这些组件会报告为 skipped。

技能挂载同时也是 `skill-claude-code` 语义 metadata 的 consumer：`skillToolRestriction`/`applySkillRestriction` 把 `allowed-tools` 变成 scoped `tools.restrict()`，`resolveSkillExecution` 路由 `context: fork` 并在 subagent seam 缺失时（被报告）降级为内联，`registerSkillPathActivator` 挂上 `paths` 条件激活，`activationFor` 报告是否禁用内联 shell（`shell: false` 的技能）。`mountCcPlugin` 返回 `{ report, dispose }`——供宿主 UI 展示的逐组件报告，以及回收每个挂载的 disposer（context 卸载时自动调用）。

刻意排除在加载器之外的内容：清单 schema 是聚焦子集（name/version/description/author 加六个组件字段），用手写校验以得到精确的「携带插件名抛错」，而不是驱动一个完整的 schemastery config——未知顶层字段被忽略，与 Claude Code 一致。agent provider 转发 `start` 到命名后端（默认 `fork`），而不是重新实现 agent 循环，因此执行一个已加载的 CC agent 仍需要 subagent seam 上存在 `fork` 后端。

## 验证

Vitest 运行五个 suite（54 个测试），使用临时目录 fixture 与 fake seam：manifest 解析错误（缺失/带空格的名字、命令 source/content 互斥、非法形状）、每个组件的挂载/skip/报告、effect 卸载（回收每个已挂载组件）、`allowed-tools` 限制接线、`context: fork` 降级、`paths` 激活。包 `tsc --build`（exit 0）以及基座回归（`skill-claude-code` + `claude-code-agents`，81 个测试）保持绿色。

## 备选方案

**把 hooks/mcp/settings 的翻译挪进 harness 自有的包中。** 否决：每个 seam 都是服务端关切，没有单一归属者；把所有翻译集中在一个兼容性加载器里，能让外部格式的映射在一起，同时保持每个 harness 包不变。

**让缺失的主机 seam 使整个加载失败。** 否决：清单是部署唯一能完整控制的部分；缺失可选 seam（尤其是 guest `hooks`/`mcp`）应当降级为报告 skip，而不是整个插件失败。

**用 schemastery Config 驱动清单校验。** 否决：清单是带 union 形状（路径 / 列表 / 对象映射）与宽容顶层处理的跨包兼容格式；手写校验器能给出精确、可测试的失败，且避免为一个解析边界依赖 config schema。

## 影响

任何带 `plugin.json` 的 Claude Code 插件目录现在都能被 harness 挂载，无需重写清单。宿主 UI 可以展示逐组件报告，禁用插件会回收每个挂载。代价是 `hooks`、`mcp`、`settings` 组件依赖 harness 目前尚未提供的 guest seam，因此在部署提供它们之前默认报告 skipped，而 agent 执行需要在运行时存在 `fork` 后端。
