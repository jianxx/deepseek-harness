# Agent Note: 基于可继续子代理的协调模式

Status: implemented

[English](2026-08-14-coordinator-mode.md) | 中文

## Problem

DeepSeek Harness 缺少一种"协调而非编辑"的一等会话姿态。拼装它的组件都已存在——可继续子代理、`send_message`/`interrupt_agent`/`list_agents` 控制工具、`report` 工具、作用域化的 `tools.restrict()`、作用域化的 prompt 区段，以及 subagent 管理器的 `subagent-settled` 完成唤醒——但没有一个包会在激活某种协调角色时，把 agent 限制到委派与只读工具、在系统提示中说明该角色、并在一套模式下暴露模型可见的调度工具。

## Decision

`@deepseek-ai/dsh-coordinator`（`packages/subagent/coordinator`）是一种作用于 agent 作用域的编排模式。激活解析 `Config.enabled ?? DSH_COORDINATOR_MODE`；未激活时本包不注册任何内容，因此 preset 可以无条件挂载它。激活时需要 agent 作用域，并全部限定在该 agent 作用域内安装：

- `coordinator:mode` prompt 区段（顺序 110），说明委派角色、调度工具清单以及结果回流协议；
- 调度工具 `spawn_worker`、`send_to_worker`、`worker_broadcast`、`worker_tasks`——它们是 `startContinuable`/`followup` 与实时 Agent 注册表之上的薄适配层，并持有每次安装独占的名称↔子 id 注册表；
- 作用域化的 `ctx.tools.restrict()` 掩码，默认为 `{ deny: ['write', 'edit'] }`，可通过 `restrict` 的 Config 调整。

`installCoordinatorMode(agent, ctx, config)` 安装这些注册；`apply(ctx, config)` 是 preset 编排进 agent 作用域的、带激活开关的命名空间插件接缝。释放返回的 disposer（或插件 fiber）会反转所有注册，从而恢复完整工具面。

结果回流与完成均属复用而非重新实现。worker 通过 `tool-subagent-report` 上报；当其结束（settle）时，subagent 服务的 continuation 结算已把它的 `subagent-settled` 通知作为唤醒消息注入协调者的会话。协调包记录这一复用，不重复实现该唤醒。

模式在 resume 时的持久性交由组合负责：preset 把 coordination 固定进会话的 `agent.cordis.yml` 组合，因此 resume 时重新挂载会依据同一 config/env 开关复现 restrict、区段与工具。不新增会话事件类型。

## Alternatives considered

- 一个自动遮蔽所有 agent 的全局插件：被否决，因为 `tools.restrict()` 是 agent 作用域操作，从普通上下文遮蔽所有 agent 属部署缺陷；因此在非 agent 作用域激活会明确失败。
- 把完成唤醒重新实现为监听 `subagent/end` 的协调者专属监听器：被否决，因为 subagent 管理器已投递唤醒父级的 `subagent-settled` 完成通知；协调包只断言并记录这一复用。
- 把模式开关持久化为新的持久会话事件：被否决；现有 config/env + preset pin 机制即可在 resume 时复现模式，无需新增事件类型。

## Testing

`packages/subagent/coordinator/tests/coordinator.spec.ts` 在 agent-loop mock 适配器与进程内 spawn 提供者之下驱动该模式，断言：激活开关（Config 与 env）、写工具限制及其在 dispose 时的移除、注入的 `coordinator:mode` 区段、被覆盖的 `allow` 掩码、禁用时的 no-op、重激活复现模式（resume）、非 agent 作用域时的明确失败、命名的 `spawn_worker`/`send_to_worker`/`worker_broadcast`/`worker_tasks` 路由、未知 worker 与无 agent 的错误、命名空间导出形态，以及已结束 worker 的 `subagent-settled` 通知确实到达协调者会话。

## Consequences

协调角色如今由既有的 subagent 接缝组合而成，而非新的循环机制，从而保持 `agent-loop` 不被改动（符合 plugins-not-loop-changes 约定）。默认 deny 掩码点名两个典型写工具，并可通过 Config 调整，因此使用不同写工具名的部署应配置 `restrict` 而非被静默限制。由于 restrict 仅接受作为全局工具存在的名字，在缺少 `write`/`edit` 的部署中激活默认掩码会明确失败，而这正是期望的契约。
