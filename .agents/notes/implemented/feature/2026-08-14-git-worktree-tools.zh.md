# Agent Note: Git worktree tools — EnterWorktree / ExitWorktree over the shell seam

Status: implemented

[English](2026-08-14-git-worktree-tools.md) | 中文

## Problem

编码 agent 需要把一段试探性工作与主工作树隔离：基于独立分支创建 git worktree，在其中工作，随后选择保留或丢弃。Claude Code 为此提供 `EnterWorktree` / `ExitWorktree` 工具；DeepSeek Harness 一直没有 harness 内等价物。忠实移植的障碍在于会话工作目录：本 harness 中 `session.header.cwd` 是 `readonly`、由存储持有的字段，在会话创建时冻结（按设计不入事件日志），因此工具无法像参考实现的 `process.chdir`+`setCwd` 那样在会话中途修改 cwd。每个模型 shell/fs 调用都会重新读取这个不可变 header 作为其默认 workdir。

## Decision

发布 `@deepseek-ai/dsh-tool-git-worktree`（包 `packages/workspace/tool-git-worktree`），一对模型工具：所有 git 都经 `ctx.shell` seam 运行（先 `resolve` 再 `run`，绝不直接 spawn），并用 `ctx.fs` 校验每个磁盘路径都留在仓库内。所有 git 命令构造集中在一个模块（`src/worktree.ts`），以不透明的 `{ command, workdir, label }` 值给出，未来替换为纯 JS git 后端时只需替换这一个模块，而非每个调用点。

- **EnterWorktree** 接受可选 `name`（缺省生成随机 `形容词-名词-后缀` slug），从 agent 的会话 cwd 经 `git rev-parse --show-toplevel` 定位仓库根，基于 HEAD 建 `worktree-<name>` 分支，并执行 `git worktree add -B`。不在 git 工作树内时返回结构化错误而不做任何更改。
- **ExitWorktree** 接受 `action`（`keep`/`remove`）与可选 `discard_changes`。`keep` 清除会话并返回原 cwd，不触碰工作树。`remove` 先用 `git status --porcelain` 与 `git rev-list --count <base>..HEAD` 探测并**失败即关闭**——状态不可核实、存在未提交文件或新提交时，除非显式 `discard_changes: true`，否则拒绝移除，并列出证据。
- 两个工具都为 `isConcurrencySafe = () => false`。活跃 worktree 会话是进程级单例，对应 claude-code 参考实现。

### cwd 切换机制

由于真正的会话 cwd 修改不可能实现（`session.header.cwd` 为 `readonly` 且由存储持有），worktree 切换通过两种对不可变会话 cwd 安全的方式表达：

1. 在插件 apply 时注册的 `tool:worktree:cwd` `ctx.systemPrompt` 运行时上下文：活跃 worktree 存在时报告其路径为当前工作目录（否则不贡献任何内容）。作为持久的模型可见运行时事实，满足「模型可见 ⟺ 已记录」契约。
2.  `EnterWorktree` 结果声明新的工作目录，并告知模型后续 shell/fs 调用需传入与返回的 `worktreePath` 相同的 `workdir`（bash/fs 工具按调用解析该 `workdir`，因此即使默认值被钉死，显式路径也会落在 worktree 中）。

这是 harness 对参考实现「环境 cwd 切换」的、由 seam 支持的替代方案，特此记录，因为下一位工程师会合理地追问为什么 worktree 不是真正的 cwd。

### 破坏性——在无 `isDestructive` 字段的情况下表达

`dsh-tools` 的 `defineTool` 没有 `isDestructive` 字段（只有 `isConcurrencySafe`），因此 `ExitWorktree(remove)` 的破坏性通过权限友好的、人读的工具描述以及 `presentCall` 中 `remove` 与 `keep` 卡片的区别表达。这是 harness 黏合层能提供的最接近方案；未来若增加 `isDestructive`，则可将它从 prose 提升为字段。

## Alternatives considered

- **把 `session.header.cwd` 改为指向 worktree。** header 为 `readonly` 且深度冻结，明确是保持在事件日志之外的存储关注点；在会话中改写它会破坏持久化身份，且不受支持。已拒绝。
- **专门的会话级 cwd 覆盖服务**（一个按会话可变的「活跃 cwd」，`tool-bash` 与 `tool-fs` 在 `header.cwd` 之前都查询它）。这是「正确」的长期形态，也是参考实现得以工作的确切原因，但它会改动 `tool-bash`/`tool-fs`——一个超出首个能力包范围的跨包行为变更，并对会话日志有重持久化与重放影响。推迟；worktree cwd 注入使切换今天就能对模型可见。
- **在 `dsh-tools` 中赞助 `isDestructive`。** 便捷，但工具语义归属于 `core/tools`；描述加呈现的方式无需改 core 即可交付安全信号。为本 PR 拒绝。

## Consequences

- worktree 在真实 git 上可可靠创建与移除，remove 门保护未提交/未合并工作（每个探测失败都失败即关闭——绝不会让静默 0/0 摧毁工作）。
- 模型可见的 cwd 事实通过运行时上下文和结果消息反映 worktree，但后续 shell/fs 调用必须传入 `workdir`；bash/fs 工具不会默认继承 worktree。这是该机制在正确性上换取来的、已记录的局限。
- 一个进程至多持有一个活跃 worktree（单例状态），与参考一致；单进程内的多会话隔离未被建模，若日后需要将引入按会话键。
- 未来纯 JS git 后端将替换 `src/worktree.ts`；未来 `isDestructive` 提升与会话 cwd 覆盖是自然的后续工作，各自由本 note 交叉引用。
- 按惯例 CI 的按文件覆盖门在 `index.ts` 的错误/防御分支上尚未达标（`gitFailure` 回退、`assertPathInRepo` 越界分支与 abort 路径）；本包测试覆盖了生命周期、安全与呈现路径，且 typecheck 干净。
