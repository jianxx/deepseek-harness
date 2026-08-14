# Agent Note: 无模型微压缩作为压缩家族配套服务

Status: implemented

[English](2026-08-14-compaction-parity.md) | 中文

## 问题

完整摘要昂贵且受模型门控：`dsh-compaction-basic` 只在压力或溢出达到条件时才做摘要，即便此时单个过大保留单元也可能难以通过表层压缩消除。而真正撑大长会话的，往往是模型已不必再逐字需要的常规工具输出——一段很旧的 `bash` 转写、早期的一次 `grep` 分页、一条过时的 `web_fetch` 正文。在摘要扫描运行之前一直用完整保真度保留每个工具结果，是在浪费本可由更廉价、无模型变换更早、更频繁收窄的上下文。

Claude Code 的压缩词汇把这一需求拆成两条容易混淆的互补策略：*微压缩（microcompact）* 只按保留窗口把最旧的工具结果折叠为占位符，而 *反应式压缩* 与 *阈值自动压缩* 运行摘要扫描。DeepSeek Harness 已在 `dsh-compaction-basic` 中提供反应式与阈值策略（在 `agent/pre-step` 上测压力、在 `agent/request-error` 上处理溢出，二者都有可由 Config 调优的重试/熔断次数），另有一个头/中/尾内容修剪器（`dsh-compaction-tool-result-pruner`）。所缺的是**保留窗口**策略：依据工具调用 id 识别旧工具结果，将其折叠到窗口之下，并让这一决策保持稳定且可从日志重建。

## 决策

新增 **`@deepseek-ai/dsh-compaction-micro`**，作为压缩家族中的无模型配套服务（`ctx.microcompactor`），以携带 `static Config` 的 `Service` 形式配置。它与 `dsh-compaction-tool-result-pruner` 形态一致，且**不**实现 `CompactionEngine`——它是供后端或显式调用方组合的策略，而不是第二个后端。

### 按工具调用 id 的保留窗口

`microcompactSession(session)` 按表层顺序快照当前 `tool/result` 节点，并原样保留最近的 `retainResults` 个；更早的结果都可被折叠。关联依据是 `ToolResultMessage.source.callId`——即消息携带的工具调用 id——这与整个循环使用的 `tool/call` ↔ `tool/result` 配对一致。每个被折叠结果都被一个携带 `{ surfaceOp: { op: 'replace', start, end }, sourceEventSeqs: [originalSeq] }` 的新追加 `tool/result` 替换，展开完整原始数据且只改 `content`（保留 `turn`、`step`、`callId`、错误字段、`meta`）。替换紧随 `compaction/prune` 影子价格事件（镜像修剪器的共享协议），使纯消费者无需逐个节点保留即可扣除被遮蔽节点的 token 价格。

### 占位符复用引用的 spill locator

当原始文本引用了 spill 产物（`… stored at: <locator>.`）时，占位符会重新嵌入该 locator 句子，使模型仍能读取完整结果。`reuseSpillLocator(text)` 提取第一句这样的句子，占位符将其逐字带入替换事件——因此 locator 可从日志重建（模型可见 ⟺ 已记录）。文档将其标注为尽力而为，并匹配 `dsh-tool-fs` 类 `stored at:` 措辞；若某工具以不同措辞呈现 locator，则不会重新嵌入。

### 冻结：决策稳定，提示逐字节一致

占位符始终以固定的 `MICROCOMPACT_MARKER` 开头。后续扫描依据该标记识别已折叠结果，绝不再做二次决策，因此对未变化历史的重复执行不会落地任何替换，并生成逐字节一致的提示（`stable: true`）。这保证了在重复的 pre-step 调用之间提示缓存可复用——重复运行不得再次使缓存失效。

### 持久化决策记录

每次替换都会追加一条 `compaction/microcompact` 会话事件（通过声明合并扩展进 `dsh-compaction` 的 `SessionEventMap`，向后兼容地扩展既有词汇），记录 `originalSeq`、`replacementSeq`、`callId` 以及重新嵌入的 `spillLocator`。由于替换内容本身已携带确定性标记，即便没有此事件，决策也能从回放与代码重建；该记录让纯消费者可读地掌握窗口与冻结策略。

### 可开关、可组合的流水线

`auto: true` 会注册一个 `agent/pre-step` 钩子，在回合请求之前运行微压缩扫描，使 `dsh-compaction-basic` 的摘要器在其自身压力流程内读到已经过窗口收缩的表层。`auto: false`（默认）则使其成为显式调用，使每个配套服务都能独立开关、并与修剪器组合，而无需在包之间耦合。

## 曾考虑的替代方案

- **实现 `CompactionEngine` 的新压缩后端**：被否决。微压缩不做摘要，也没有 `compactionId` 生命周期；它与修剪器一样是无模型变换。做成完整后端会夸大其作用，并强加并不适用的锁/括号语义。
- **并入 `dsh-compaction-basic`**：被否决。basic 是摘要后端，把独立的保留窗口策略塞入会耦合两种策略及其 Config。按策略一个服务的家族模式能让它们各自独立开关、独立测试。
- **（模型）摘要式微压缩**：被否决。其全部意义在于无需模型调用即收窄上下文；占位符加保留的 locator 更廉价且无模型，真正的摘要本就是 `compaction-basic` 在压力时要做的事。
- **仅内存 memo（无确定性标记）**：被否决。仅进程内的决策集无法跨回放存活；把冻结绑定到确定性内容标记，才能让决策仅凭日志与代码即可重建。

## 后果

- **包**：`packages/compaction/compaction-micro` 是新的 Host 包（注册于 `tsconfig.host.json`），含 README 三件套、与修剪器一致的 invariant 配套服务，并在 `compaction` 词汇中新增 `compaction/microcompact`。
- **`ctx.microcompactor`** 与 `ctx.toolResultPruner` 一样成为可选无模型配套服务；两者都非 `dsh-compaction-basic` 所必需。
- **模型可见 ⟺ 已记录** 成立：占位符、重新嵌入的 locator 与决策记录都是可从日志重建的持久化会话事件。
- **暂缓**：本文未构建一个以 Config 数组声明、总控排序所有策略（微压缩、修剪、摘要、反应式）的通用流水线框架；每个配套服务保留各自的 `auto` 开关，由后端显式组合。反应式与阈值策略已存在于 `dsh-compaction-basic`，保持不变。

## 测试

基于伪造会话事件序列的单元测试钉住了保留窗口（超出 `retainResults` 的最旧结果折叠、最新结果原样保留）、冻结/幂等（第二次相同执行不落地任何替换，表层逐字节一致）、从日志重建决策记录、spill locator 重新嵌入、配置校验以及 invariant 配套服务契约。
