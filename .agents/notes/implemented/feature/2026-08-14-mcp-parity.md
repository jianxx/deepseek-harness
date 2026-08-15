# Agent Note: MCP parity with Claude Code

Status: implemented

English | [中文](2026-08-14-mcp-parity.zh.md)

## Problem

The `dsh-mcp-client` bridge connected MCP servers only over `stdio` and Streamable HTTP and bridged only their `tools` capability. Claude Code's MCP surface is broader: a `.mcp.json` workspace-configuration loader, OAuth (RFC 9728 → RFC 8414 discovery, PKCE, dynamic client registration, token refresh), resources, prompts, and an SSE transport. Reaching that surface means deciding how each capability maps onto existing harness seams rather than hand-rolling transports.

## Decision

Add a new `@deepseek-ai/dsh-mcp-config` package that parses a Claude Code-style `.mcp.json` (`mcpServers` map), validates it (malformed input throws at load), expands `${VAR}` and `${VAR:-default}`, dedupes names, applies an enterprise `allow`/`deny` policy, and translates the accepted servers into `dsh-mcp-client` registrations. It owns only read/validation; it mounts nothing and does no I/O.

Extend `dsh-mcp-client` with:

- **SSE transport** — a `transport: 'sse'` config member mapped to the SDK's `SSEClientTransport`.
- **OAuth** — a `ctx.credentials`-backed `OAuthClientProvider` (`CredentialsOAuthClientProvider`) wired through the SDK's `authProvider` option for `streamable-http` and `sse`. Tokens, registered-client info, the PKCE verifier, and discovery state persist under server-derived credential references (referenced, not inline). The SDK already implements RFC 9728/8414, PKCE, dynamic client registration, and token refresh behind that interface, so this package supplies only the durable storage half and a single mid-session `401` retry in the tool executor.
- **Resources** — exposed as two server-qualified model tools, `mcp__<serverName>__list_mcp_resources` and `mcp__<serverName>__read_mcp_resource`, when the server declares the capability. The `ctx.fs` seam abstracts real filesystems over `FsTarget`/`readBytes` and cannot represent virtual MCP resources, so the two-tool fallback is the delivered surface, not an fs Provider.
- **Prompts** — each MCP prompt registers as a runtime skill on `ctx.skills` when the server declares the capability. The harness skill registry enforces a lowercase-kebab name grammar, which `mcp__<server>__<prompt>` (double underscores) cannot satisfy, so names map to `mcp-<server>-<prompt>`. Argumentless prompts resolve via `prompts/get` and their rendered text is the body; prompts requiring arguments are documented with their argument contract. MCP-sourced skill bodies are inert prose — never executable shell.

The connection supervisor keeps all capabilities (tools, resource bridge, prompt skills) in one serialized swap chain, keeps the last-good generation across an outage, and unregisters everything on give-up or disposal (firing `tools/change`). Tools remain bridged unconditionally (long-standing behavior); only the resource and prompt bridges are capability-gated via `getServerCapabilities()`.

## Alternatives considered

**Expose resources through `ctx.fs`** — rejected. The `ctx.fs` Service Definition is a real-filesystem abstraction (`resolve` to `FsTarget`, `processPath`, `readBytes`, containment); virtual MCP resources (arbitrary URIs with server-owned contents) do not fit its target model. The two model tools are the capability map's prescribed fallback.

**Prompt names as `mcp__<server>__<prompt>`** — rejected for now. The `ctx.skills` registry rejects the double-underscore spelling (`SKILL_NAME` is `[a-z0-9]+(?:-[a-z0-9]+)*`), so the kebab mapping is used. Distinct identities may rarely collide; the registry's first-wins policy logs the duplicate.

**Hand-roll OAuth transport auth** — rejected. The MCP SDK already owns RFC 9728/8414 discovery, PKCE, dynamic client registration, and refresh behind `OAuthClientProvider`; re-implementing them duplicates a maintained dependency. This package fills only the persistence seam and the `401` retry.

## Consequences

The bridge now covers the Claude Code MCP surface: `.mcp.json` config loading, `stdio`/`streamable-http`/`sse` transports, OAuth token persistence via `ctx.credentials`, resources as two tools, and prompts as skills. E2E real-server coverage is out of scope (CI/e2e domain); transport/OAuth/capability behaviour is unit-tested with mock clients and a mock fetch-free flow. Since OAuth interactive `redirectToAuthorization` cannot drive a browser headlessly, it logs the authorization URL; completing the flow still requires an operator.
