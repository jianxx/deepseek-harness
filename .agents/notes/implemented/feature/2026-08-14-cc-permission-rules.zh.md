# Agent Note：Claude Code 兼容的权限规则

Status: implemented

[English](2026-08-14-cc-permission-rules.md) | 中文

## 问题

本 harness 已有审批缝（`ctx.approval`）与粗略的权限预设，但没有能把 Claude Code 的 `ToolName` / `ToolName(content)` 权限语法映射到工具调用的规则引擎。部署无法表达「允许 npm install 但在 rm -rf 时询问」，无法让 `.git` 与 shell 配置文件写入在所有模式下免疫，也无法通过 settings 热编辑规则集。宿主 UI 也没有纯粹、浏览器安全的方式预览某规则会命中什么。

## 决策

**新建 `@deepseek-ai/dsh-permission-rules` 交互包持有该引擎。** 它在 `tools/pre-execute` waterfall 上解析规则，并通过单调的 `guard()` 层强制执行 bypass-immune 内容规则——复用既有审批缝，而非修改循环。

**规则语法与匹配遵循 Claude Code。** `ToolName` 或 `ToolName(content)`；content 支持反斜杠括号转义、`*` 通配符与旧的 `:*` 前缀形式。畸形规则在加载期抛出 `TypeError`（fail loud），不同于 Claude Code 的静默工具名回退——这是本规格的明确契约。

**评估是纯净、可导出的函数。** `evaluatePermission(input)` 按规格顺序收敛 allow/deny/ask/passthrough：bypass-immune → 整工具 deny → 整工具 ask（沙箱 bash 豁免）→ 按来源优先级的内容规则 → 模式（bypassPermissions/acceptEdits/plan）→ 整工具 allow → passthrough。即使处于 `bypassPermissions`，bypass-immune 命中仍 deny。

**Bypass-immune 规则是权威的单调 guard。** 插件用 `ctx.tools.guard()` 注册它们，waterfall 委托（`next()`）而非双重占有其拒绝，因此任何下游监听器或模式都无法翻盘。`evaluatePermission` 仍会报告它们，以确保宿主预览保持忠实。

**规则来自 Config 与可选 settings，按来源优先级合并。** Config `rules` 以 `config` 来源解析；可选的 `permissions` settings 命名空间（`allow`/`deny`/`ask`/`defaultMode`）提供更高优先级的规则，并通过 `installSettingsSection` 热更新。当 `ctx.settings` 缺席时，仅 Config 生效。

**模式在调用时解析。** plan 激活（通过 `foldPlanMode`）覆盖会话记录的 `permission/mode`，否则回退到 `defaultMode`；按配置可禁用 `bypassPermissions`。

## 验证

- 覆盖 parser/evaluate/plugin/invariant 套件的 66 个测试，演练转义、通配符/前缀匹配、顺序、来源优先级、bypassPermissions 下的 bypass-immune、acceptEdits/plan/bypass 模式、热更新与 fail-loud settings。
- 包级 `tsc --build` 通过。
- 通过本地二进制运行 vitest，因为 `pnpm` 包装器的依赖检查会因新 workspace 包缺少 lockfile 更新而中止（按 worktree 规则禁止 `pnpm install`）。

## 影响

新增公开包 `@deepseek-ai/dsh-permission-rules`；未改动 agent-loop 或既有扩展点。内容提取目前覆盖 shell 命令（`command`）与单一文件路径（`file_path`）；更广的工具内容覆盖与持久化授权记忆留待后续。
