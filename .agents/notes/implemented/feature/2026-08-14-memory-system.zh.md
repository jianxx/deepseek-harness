# Agent Note: 基于文件的记忆系统

Status: implemented

中文 | [English](2026-08-14-memory-system.md)

## 问题

harness 缺少跨会话、模型可见的持久化层来保存关于用户、其偏好、项目上下文或外部
资源的持久事实。对话上下文在会话结束时即消亡。Claude Code 的 memdir（`MEMORY.md`
索引 + 主题文件、自动抽取、夜间整合）是我们想要参考的设计，并已适配到 harness 的
能力缝模型。

## 决策

在新建的 `packages/memory/` 组下有两个包：

- `dsh-memory` 负责读取侧：memdir 格式与解析器、`memory` 系统提示词 section、动态
  召回。
- `dsh-memory-consolidation` 负责写入侧：轮末抽取与三重门 dream 重写，使用
  `ctx.jobs` + `ctx.subagents` 启动限制为读/搜索加记忆写入工具的后台 fork
  subagent。

所有文件访问都走可选的 `ctx.fs` 缝，因此远程或沙箱后端可无改动使用；无 provider 的
宿主将记忆挂载为空操作。召回按 agent 会话去重：本会话已注入过的主题文件不会重复注入。
记忆写入通过 `memory` section 经 `system-prompt/change` 重组装改变模型可见上下文——
本包组未为记忆文件本身引入新的会话事件（文件即持久层）。

## 与 Claude Code 参考实现的差异

`ctx.fs` 缝不暴露 `mtime`（`stat` 只返回 `version`/`type`/`size`），因此两处参考行为被
改道：

- **锁**：整合锁将持有者 PID 与上次整合时间戳存入锁文件**正文**，而非文件 mtime。
  崩溃恢复依赖过期窗口（`LOCK_STALE_MS`，默认 1 小时）回收过期持有者，而非进程存活探活。
- **召回新鲜度**：去重按会话记录已展示路径，而非 mtime+path；每次注入都会重新读取
  内容，仍能反映磁盘变更。

另有两点因缝在此处未被充分定义而做近似：会话门将存活 `ctx.sessions` 视为新会话（带
时钟的 transcript 查询已延期），Write/Edit 到记忆目录的路径作用域由 fork 提示词契约
强制（`ctx.tools.restrict` 按工具名过滤）。

## 测试

TDD 驱动：frontmatter 解析、入口截断、section 组装、召回 JSON 提取、三道门各自及组合、
锁的获取/回滚/过期回收、以及记忆工具过滤器，均针对内存版 `ctx.fs` provider 与 fake
subagent 缝进行单元测试（仓库未内置纯内存 provider，故按仓库惯例在测试中挂载本地
`FileSystem` 子类）。`pnpm vitest run packages/memory` 通过；两个包均类型检查干净。
