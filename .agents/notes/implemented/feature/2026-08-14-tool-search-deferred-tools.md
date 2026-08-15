# Agent Note: Deferred tool registration and the ToolSearch load tool

Status: implemented

## Problem

A large tool catalog costs every session twice: prompt tokens for each visible schema, and load time for heavy capabilities most sessions never use. The harness's model is "register everything visible", so there is no way to keep a heavy tool out of the model-facing schema until the model actually summons it, or to let a model discover a not-yet-loaded capability at runtime.

Refusing to load everything up front conflicts with the existing authority model: a tool a scope restricts away must not load for that scope, which requires a way to gate a name before its definition exists.

## Decision

A new package, `@deepseek-ai/dsh-tool-search`, adds two pieces on the existing effect-based registry:

**DeferredToolRegistry** — the `ctx.toolSearch` service. `registerDeferred({ name, description, searchHint?, alwaysLoad?, activate })` stores a capability without presenting it. `activate` is the real `ctx.tools.register()`. Three lifecycle guarantees follow from the effect model:

- The deferred registration is itself an effect: unloading it removes the deferred entry *and* any activated tool registration together.
- Activation is idempotent: re-activating a loaded tool is a no-op, never a duplicate registration.
- The deferred name is reserved in the tool registry (known but not visible), so a scoped `restrict()` can deny it *before* it loads; a denied name is never activated, and the ToolSearch result says why.

A `alwaysLoad` tool registers immediately at defer time and is never a deferred candidate (the generalized MCP `_meta['anthropic/alwaysLoad']` escape hatch).

**ToolSearch** — a model-facing tool with `query` + `max_results` (default 5). It ranks the deferred, not-yet-loaded set with weighted substring/token matching over name, `searchHint`, and description (no vector dependency), activates admitted hits via the callbacks, and returns a model-readable summary of names and descriptions. Loaded tools become visible on the next assembly and drop out of the deferred set.

### Tool-registry additions

Two read effects on `@deepseek-ai/dsh-tools` make gating legal and observable:

- `ctx.tools.reserve(name)` registers a capability **name** in a layer's reserved table — it joins the known/restrictable universe (`restrict`, `toolOrder`) with no visible definition.
- `ctx.tools.isAdmitted(name, scope?)` reports whether a global name passes every scoped restriction on the chain, independent of registration, so a deferred registry can test the gate before loading.

The deferred registry calls `reserve` on every `registerDeferred`, which is what lets a scope `restrict()` a heavy tool's name before its definition loads.

## Why this shape

Deferral is a load-time concern, so it lives as an effect on the existing registry rather than a flag on `ToolDefinition`: the schema/provider plumbing already derives purely from registered definitions, so an unregistered deferred tool trivially stays out of the prompt. Activation reuses `ctx.tools.register()` and its `tools/change` notification, keeping one registration path and one authority model.

The restriction check is deliberately a read of the tools registry's own admission rather than a parallel permission system: a deferred tool honors exactly the same allow/deny mask a loaded one would, and ToolSearch cannot become an end-run around `restrict()`.

## Conventions

Deferred tools declare a `generic` render intent (pure `presentCall`/`presentResult` on args). Matching is lexical and deterministic; synonyms that share no token are not matched. Loading is global (host plane): a per-agent scope sees a loaded tool only when its restriction admits it, and there is no per-conversation discovery history.

## Links

- [Tool authoring reference](../../../../docs/cookbook/adding-a-tool.md)
- [Tool schema catalog](../../../../docs/tool-catalog.md#deepseek-aidsh-tool-search)
