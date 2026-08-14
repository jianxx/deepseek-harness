# Agent Note: 带子代理路由的编排工作流

Status: implemented

[English](2026-08-14-orchestration-workflow.md) | 中文

## Problem

本仓库由 agent 构建和维护，而默认形态——单个模型在单一上下文里包办规划、执行、验证和审查——有三个结构性失效模式。上下文被本可委派的阅读和机械输出转发消耗，留给综合的空间变少。重推理阶段（设计、计划审查、根因分析）与机械阶段（批量编辑、跑检查）以相同模型深度运行：要么为 Sonnet 级工作付 Opus 级时延，要么让 Opus 级决策只得到 Sonnet 级深度。并且缺乏成文的审查门禁时，计划未经评审即落地，失败的修复被叠在坏计划上打补丁，subagent 输出未经提炼就漏进最终答复。基于 worktree 的会话还有第四个具体失效：`git worktree` 检出不含被 gitignore 的 node_modules/，所有 pnpm 门禁都会以 module-not-found 失败，每个会话都要重新诊断一遍。

## Decision

根 `AGENTS.md` 新增 **Orchestration workflow** 章节：Fable 担任编排者，委派阅读与机械执行，主上下文留给综合。路由固定：重推理工作交给 `deep-reasoner`（Opus），已批准计划的机械执行交给 `fast-worker`（Sonnet），Codex（`/codex:rescue --background`）视为对等的工程师。Plan-first 要求在特性开发、超过 2–3 个文件的改动、存在多种可行方案、或重构/迁移/删除之前进入 plan mode，并在 ExitPlanMode 之前由 deep-reasoner 以 Staff Engineer 身份对计划做冷评审。不可逆或代价高的决策由 deep-reasoner 与 Codex 并行盲审，分歧本身就是发现。失败恢复在修复连败两次、计划假设被现实推翻、或范围溢出时立即返回 plan mode——绝不在坏计划上打补丁。

两个已提交的 agent 承载受支持的 subagent 侧：`.claude/agents/deep-reasoner.md`（对抗式评审者；返回 Recommendation / Reasoning / Risks-unknowns）和 `.claude/agents/fast-worker.md`（严格按规格执行，规格与现实矛盾时停止并上报而非即兴修补；返回 Changed / Checked / Deviations / Blockers）。

两个脚本支撑该章节的规范性引用。`scripts/link-worktree-deps.sh` 通过 `git rev-parse --git-common-dir` 发现主检出中的每个 node_modules，并在 worktree 的相同相对路径逐一建立符号链接——幂等，且在主检出中是无操作。`scripts/check-subagent-paste.mjs` 是 Stop hook，用于标记疑似整段转述 subagent 输出（一个 ≥40 行的引用块或围栏代码块，且带有 agent 输出契约的成对标题头）；对任何畸形输入 fail-closed；默认输出用户可见的 `systemMessage`，仅在 `SUBAGENT_PASTE_HOOK=block` 下输出阻断决定，并在 `stop_hook_active` 期间静默以避免 block 上限循环。行为由 `scripts/check-subagent-paste.spec.ts` 固定（九个子进程用例）。该 hook 注册在用户本地的 `.claude/settings.local.json` 中，`.gitignore` 现已覆盖此文件。

`scripts/doc-budgets.manifest.json` 将 AGENTS.md 上限从 1900 上调至 2100，依据 docs/AGENTS.md 的条款（"内容否则就得删时可上调"）论证：新章节的忠实压缩（588 → 287 词）加上对既有行文的无损收紧（180 词），在保留全部原规则的前提下实测地板为 2100 词。

"对本文件或 agent 契约的编辑都是 prompt change" 规则移入 "Editing these instructions"，作用域覆盖 `AGENTS.md` 与 `.claude/agents/`：commit message 需写明预期可观察的行为变化，并在后续真实会话中验证。

## Alternatives considered

**单一通才形态，委派规则不成文。** 不成文的委派规则随会话漂移，也没有成本/时延控制点：每个阶段都以同一模型深度运行。被否决的形态正是路由表与审查门禁要防住的东西。

**粘贴检测 hook 默认阻断。** 启发式阻断会误伤正当的长引用（文档摘录、评审者索要的转写）。默认仅信号、由 `SUBAGENT_PASTE_HOOK=block` 显式开启严格模式，保持 fail-closed 与保守立场：检测要求 ≥40 行的块且成对契约标题头同时成立，宁可漏报不可误报。

**每个 worktree 完整 `pnpm install`。** 每个 worktree 花费数分钟安装并重复占用磁盘，而 pnpm 的内容寻址 store 已使符号链接的 node_modules 等价。发现加逐目录符号链接即时且幂等。

**提交 hook 注册。** `.claude/settings.local.json` 按 Claude Code 惯例属用户本地，还承载本地权限放行列表；提交它会将同一份注册（及其权限条目）强加到所有检出。该文件保持 gitignore；AGENTS.md 记录该 hook、其位置与两种退出方式。

**守住 1900 词上限改为删规则。** 无损压缩之外的剩余距离只能来自真正的规则文本（测试策略范例、类型安全文体规则、布局导读）。为凑预算删宪法内容颠倒了政策的优先级；本次上限上调以上述实测数据作为论证。

## Consequences

每个会话都从 `AGENTS.md` 加载该工作流；路由、计划冷评审、并行盲审与失败恢复触发条件成为常规实践，其可观察变化即 commit message 所述。`.claude/agents/*.md` 成为 prompt 载体文件，其编辑遵循 prompt-change 规则。Stop hook 仅在本地 settings 注册它的检出中生效。AGENTS.md 恰好落在 2100 词上限，未来新增内容必须先压缩，或自带上限论证。
