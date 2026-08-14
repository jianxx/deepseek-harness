# Agent Note：与 Claude Code 的 MCP 对齐

Status: implemented

[English](2026-08-14-mcp-parity.md) | 中文

## 问题

`dsh-mcp-client` 桥只通过 `stdio` 与 Streamable HTTP 连接 MCP 服务器，且只桥接了 `tools` 能力。Claude Code 的 MCP 覆盖面更广：`.mcp.json` 工作区配置加载器、OAuth（RFC 9728 → RFC 8414 发现、PKCE、动态客户端注册、token 刷新）、资源、提示词，以及 SSE 传输。要达到该覆盖面，就需要决定每种能力如何映射到既有 harness seam，而非手写各传输。

## 决策

新增 `@deepseek-ai/dsh-mcp-config` 包，解析 Claude Code 风格的 `.mcp.json`（`mcpServers` 映射），进行校验（畸形输入在加载期抛错）、展开 `${VAR}` 与 `${VAR:-default}`、去重、应用企业级 `allow`/`deny` 策略，并把通过的服务转换为 `dsh-mcp-client` 注册项。它只负责读取/校验；不自行挂载，也不做任何 I/O。

扩展 `dsh-mcp-client`：

- **SSE 传输**——新增 `transport: 'sse'` 配置成员，映射到 SDK 的 `SSEClientTransport`。
- **OAuth**——一个由 `ctx.credentials` 支撑的 `OAuthClientProvider`（`CredentialsOAuthClientProvider`），通过 SDK 的 `authProvider` 选项接入 `streamable-http` 与 `sse`。token、已注册客户端信息、PKCE verifier 与发现状态持久化在由服务器派生的凭据引用下（引用而非内联）。SDK 已在该接口之后实现 RFC 9728/8414、PKCE、动态客户端注册与 token 刷新，因此本包只提供持久化半边以及工具执行器中的单次会话中途 `401` 重试。
- **资源（Resources）**——当服务器声明该能力时，以两个服务器限定的模型工具 `mcp__<serverName>__list_mcp_resources` 与 `mcp__<serverName>__read_mcp_resource` 暴露。`ctx.fs` seam 是基于 `FsTarget`/`readBytes` 的真实文件系统抽象，无法表达虚拟 MCP 资源，因此交付的表面是两个工具的回退方案，而非 fs Provider。
- **提示词（Prompts）**——当服务器声明该能力时，每个 MCP 提示词都作为运行时技能注册到 `ctx.skills`。harness 技能注册表强制执行 lowercase-kebab 名称语法，`mcp__<server>__<prompt>`（双下划线）无法满足，因此名称映射为 `mcp-<server>-<prompt>`。无参数提示词通过 `prompts/get` 解析，其渲染文本成为正文；需要参数的提示词则以参数约定作为文档。MCP 来源的技能正文是惰性纯文本——绝不包含可执行的 shell。

连接 supervisor 将所有能力（工具、资源桥、提示词技能）纳入一条串行化的交换链，在中断期间保留最后一个正常世代，并在放弃或 dispose 时全部注销（触发 `tools/change`）。工具保持无条件桥接（长期行为）；只有资源桥与提示词桥按 `getServerCapabilities()` 进行能力门控。

## 备选方案

**通过 `ctx.fs` 暴露资源**——否决。`ctx.fs` Service Definition 是真实文件系统抽象（`resolve` 到 `FsTarget`、`processPath`、`readBytes`、包含关系）；虚拟 MCP 资源（任意 URI，内容归服务器所有）不符合其目标模型。两个模型工具是能力映射规定的回退。

**提示词名使用 `mcp__<server>__<prompt>`**——暂缓。`ctx.skills` 注册表拒绝双下划线拼写（`SKILL_NAME` 为 `[a-z0-9]+(?:-[a-z0-9]+)*`），因此采用 kebab 映射。不同的身份可能偶发冲突；注册表的 first-wins 策略会记录重复项。

**手写 OAuth 传输认证**——否决。MCP SDK 已在 `OAuthClientProvider` 之后实现 RFC 9728/8414 发现、PKCE、动态客户端注册与刷新；重写会重复一个受维护的依赖。本包只补充持久化 seam 与 `401` 重试。

## 结论

桥现在覆盖 Claude Code 的 MCP 表面：`.mcp.json` 配置加载、`stdio`/`streamable-http`/`sse` 传输、经由 `ctx.credentials` 的 OAuth token 持久化、以两个工具呈现的资源，以及以技能呈现的提示词。E2E 真实服务器覆盖超出范围（CI/e2e 域）；传输/OAuth/能力行为用 mock 客户端与无 mock fetch 的流程做单元测试。由于交互式 `redirectToAuthorization` 无法在 headless 下驱动浏览器，它会记录授权 URL；完成流程仍需操作者介入。
