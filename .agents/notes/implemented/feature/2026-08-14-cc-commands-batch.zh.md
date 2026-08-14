# Agent Note：类 Claude Code 本地斜杠命令包（批量）

Status: implemented

[English](2026-08-14-cc-commands-batch.md) | 中文

## 问题

Claude Code 内置了一组本地斜杠命令（`/cost`、`/export`、`/status`、`/stats`、`/doctor`），它们从会话状态或环境直接作答，无需模型轮次。DeepSeek Harness 已有命令注册表（`ctx.commands`）以及足以支撑同样人机交互的会话事件模型，但这些对应关系此前没有实现。每个命令还要承担仓库的结构性义务：按 `command-<name>` 惯例建立一个包、一次 `ctx.commands` 注册、纯折叠／格式分离、一套测试、双语 README 以及一个 invariant 伴生包。

## 决策

每个命令一个包，均为函数插件，在 `ctx.commands` 上各注册一个全局命令，语义为 `type=local`——处理器在无模型分派的情况下运行，也不消耗 token：

- `packages/session/command-cost` — `/cost`：把 `assistant/message` usage 对照最新 `request/header` 模型路由折叠为按模型桶，并按部署 USD `modelTable`（每百万 token，来自 Config）计价。`'*'` 项为通配默认列。
- `packages/session/command-export` — `/export`：把会话日志渲染为 markdown（默认）或无损 JSON，并通过 `ctx.fs`（resolve＋writeText）写入。`Config.defaultDir` 为回退目录。
- `packages/session/command-stats` — `/stats`：从持久日志折叠 turn、step、消息计数、工具调用分布与 token 汇总。
- `packages/interaction/command-status` — `/status`：显示当前模型（最近 `request/header`）、权限 preset（挂载时有 `ctx.permissionPresets`）、会话 id 与工作目录（`session.header.cwd ?? process.cwd()`）。来源缺失时逐行省略。
- `packages/interaction/command-doctor` — `/doctor`：报告包 manifest 版本、settings 可达性（`ctx.get('settings')`）以及各接缝挂载状态，在 `ctx.llm.listProviders()` 可用时枚举 LLM provider。

### 共享约定

- **纯折叠、纯格式。** 每个包把折叠与渲染逻辑放在不依赖 cordis 的 `src/<topic>.ts` 模块中（对构造的事件序列直接测试）；`src/index.ts` 只负责收集与注册。空路径直接返回“暂无数据”类的文案，而不是输出一张全零的表。
- **平面 schemastery Config，不使用嵌套可选对象。** 当 `commands` 已挂载时，缺失的可选字段上的嵌套 `z.object` 会在插件加载时让 cordis 的 `~standard` 配置校验失败（会下钻到该对象内部）。cost 包用带 `'*'` 通配项的平面 `modelTable` 数组避免这一点，并去掉 `z<Config>` 泛型（其可变／可空推断 schema 在 `exactOptionalPropertyTypes` 下与 `readonly` 字段冲突）。
- **`request/header` 载荷是 `{ header: { config }, reason }`**，而不是裸 config；`TokenUsage` 从 `@deepseek-ai/dsh-llm` 导入（`dsh-session` 的 lib 类型中省略了它）。
- **通过 `ctx.get(name)` 读取可选服务。** status 读 `permissionPresets`，doctor 读 `llm`／`settings`／各接缝服务，走 `ctx.get`，因此服务缺失时优雅降级为省略行或 `not mounted`，而不是挂载失败。
- **测试携具**仿照 `command-goal`：真实的 `SessionStore`＋`CommandRuntime`＋`AgentRegistry` 上下文、被注册表接受的 stub agent、Loader `unwrapExports`＋dispose 检查，外加纯折叠／格式快照。`command-export` 额外挂载 `fs-local` 并写入临时目录。

### 生命周期接口事实（来自服务映射）

- 不存在 `ctx.cwd`、`ctx.hooks` 或 MCP 挂载注册表。`/status` 从 `session.header.cwd` 读取 cwd，因此它没有可发射的 MCP／hooks 行；`/doctor` 报告各接缝的存在性，但只有 `llm` 暴露公开的 provider 枚举。
- 没有 `ctx` 可注入的版本；`/doctor` 仿照 `apps/cli` 的 self-manifest 读取（`new URL('../package.json', import.meta.url)`），所有包共享 `0.1.0-rc.x` 版本。
- 运行时 invariant 伴生包为空（`apply` 注册一个 no-op 安装器），与 `command-goal`／`command-compact` 一致：这些命令适配器不拥有事件流，因此校验职责在其他领域或注册表处。

## 验证

- 对五个包运行 `vitest run`：5 个文件、43 个测试全部通过（每个命令都覆盖正常路径、空路径与格式快照；折叠逻辑用构造的会话事件序列测试）。
- 五个包的包级 `tsc -b` 全部通过。仓库的 `test:coverage` 门禁（逐文件 100%）未在本地运行；覆盖率由 CI 负责。
- 生成的文档目录（`docs/module-graph.*`、`docs/config-catalog.*`）与 `doc-sync` 的翻译配对／散文门禁未运行；README 对已记录其 git-blob 哈希，但未跑过 `verify-translation-pairing`。

## 对未来的决策价值

- 平面 Config 的教训（schemastery 插件 Config 中不要嵌套可选 `z.object`；优先用通配项）是未来任何可配置命令包应遵循的要点。
- `/cost` 日后可读取 `sessionStats` 投影以获得轮转耗时，`/doctor` 可在 skill／web／lsp 接缝暴露公开 provider 列表后枚举这些 provider。

## 备选方案

- **单一合并命令**（一个 `/doctor` 式处理器按子命令 token 分支）被否决：仓库的 `command-<name>` 打包惯例与按特性的测试／README 偏好每个命令一个聚焦包，且单体会把会话折叠（cost／stats／export）与环境读取（status／doctor）耦合成没有共享领域的包。
- **借助 `sessionStats` 投影做 `/stats`** 曾被考虑并搁置：该投影携带 turn／step 计数与耗时，但 `/stats` 还需要投影不暴露的工具调用分布与 token 汇总，因此对权威日志的直接折叠无需挂载投影载体即可自包含、可测试。
- **Config 中的嵌套可选 `defaultModelPrice`** 因 cordis `~standard` 校验下的加载期 schema 失败而被否决；平面 `modelTable` 数组中的 `'*'` 通配列（外加去掉 `z<Config>` 泛型）绕开了 schemastery 边界情况。

## 后果

- 五个形状统一的独立包（纯折叠＋格式、`ctx.commands` 注册、invariant 伴生包、双语 README），消费方只在需要某能力时才组合它。
- `/cost` 与 `/stats` 少量重复了 token 求和折叠逻辑而非共享车轮，从而各自独立、易于阅读；这一重复是有意且次要的。
- 接口诚实：由于这些注册表尚未公开存在，`/status` 有意不发射 MCP／hooks 行，`/doctor` 只列出 `llm` 的 provider——命令是降级而非编造数据。
- 配置驱动的定价与导出目录把所有可调项都放在部署侧而不是硬编码，代价是要求消费方必须提供 `modelTable`／`defaultDir`。
