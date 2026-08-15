# Agent Note: 兼容 Claude Code 的输出风格

Status: implemented

[English](2026-08-14-cc-output-styles.md) | 中文

## 问题

Claude Code 用户通过*输出风格*与模型建立沟通契约：一个命名的散文块，用于改变模型解释与教学的方式（内建 `Explanatory` 与 `Learning` 风格），或 `output-styles/*.md` 文件中由用户编写的自定义指示。DeepSeek Harness 没有对应的能力——部署可以设置 persona，但不存在可在运行时由人切换、且可随项目以文件形式随附的命名"模型如何沟通"贡献。

将这些风格硬编码进 agent 主循环会违背插件架构。harness 已拥有使输出风格可组合的 seam：带每次组装求值文本的系统提示词 section 注册表、带组合回退的可选用户 settings seam，以及人类命令注册表。待解决的问题是这些 seam 能否复现 Claude Code 表面——内建风格、带 `keep-coding-instructions` 的自定义 `output-styles/*.md` 文件、通过 settings 与 `/output-style` 命令切换，以及切换时触发重组装——而不改动主循环。

## 决策

`packages/compat/cc-output-styles/` 中的 `@deepseek-ai/dsh-cc-output-styles` 是构建在 `ctx.systemPrompt`、`ctx.commands` 与可选 `ctx.settings` seam 之上的函数插件。它组合三种内建风格（`default`、`Explanatory`、`Learning`），加载自定义 `output-styles/*.md` 文件，将选择以 settings 键形式暴露（带组合回退），并贡献一个系统提示词 section 与一个命令。

### 风格模型与内建样式

一个风格是 `{ name, description, prompt, builtin, keepCodingInstructions }`。`default` 贡献空 prompt（因此无 section）。`Explanatory` 指示模型解释其实现选择与代码库模式；`Learning` 指示模型协作式教学，请求以单个 `TODO(human)` 标记为门槛的简短动手实践贡献。散文为本 harness 原创——语义与 Claude Code 对齐但不复制其文本，因为本包镜像的是外部约定，而非引入其 prompt 文本。

### 自定义文件加载

自定义风格从 `<project>/.claude/output-styles/*.md` 与 harness home `~/.dsh/output-styles/*.md` 加载，靠后的项目目录覆盖同名较早风格。文件名（去掉 `.md`）即风格名——按"文件名即风格名"规则作为权威身份。frontmatter 必须提供非空 `description`；可选的 `keep-coding-instructions` 布尔值（或 `'true'`／`'false'` 字符串）默认 `true`。格式错误的 YAML、非对象 frontmatter 或缺失 description 会导致插件加载期明显失败，而非静默跳过——因为配置错误的沟通契约是配置错误，并非可忽略的文件。

### 选择与切换

当前风格是 `cc-output-styles` 命名空间中的 settings 键 `outputStyle`，通过 `installSettingsSection` 叠加在插件组合 `outputStyle` 配置之上。没有 settings 提供器时以组合值为主。`/output-style` 命令无参数时列出当前选择与可用风格，带名称时设置选择；未知名称返回列出可用风格的错误而不改变状态。存在 settings 提供器时命令通过其持久化；否则在会话内应用切换并重新发出 `system-prompt/change`。

插件注册一个系统提示词 section `cc:output-style`，order 为 `-50`（在部署 persona `0` 之前、harness 身份 `-100` 之后），其文本提供器在每次组装时读取实时选择。因此切换会重新发出 `system-prompt/change`，使下一个组装的提示词采用新风格的 section；切换时不会重新注册该 section。指向未知风格的已存选择退化为 `default` 空 section 而非使组装失败，因为外部编辑的文档并不是可操作的模型输入错误。

### keep-coding-instructions 分支

当 `keep-coding-instructions` 为 `true`（默认）时，风格正文原样贡献，并与默认编码指示并存。为 `false` 时，所贡献 section 在风格正文之前以固定语句开头，声明其取代默认编码指示 section——以 section 文本表达，因为本插件并不拥有编码指示提供器的槽位，不应注销另一 seam 的贡献。

## 测试

包级测试覆盖：内建风格内容及其差异性；frontmatter 解析（名称取自文件名、description、`keep-coding-instructions` 布尔／字符串／默认，以及对缺失 frontmatter、格式错误的 YAML、非对象 frontmatter、空 frontmatter 与缺失 description 的明显失败）；目录加载的后者优先覆盖与缺失目录容忍；自定义覆盖内建阴影的库装配；`default` 的空 section 与内建、自定义风格的正文；通过真实 settings 提供器切换并发出 `system-prompt/change`、改变实时 section；无 settings 提供器时的会话内切换；`keep-coding-instructions` 的 section 文本分支；以及命令的列出、设置与未知名称错误路径。invariant 伴生注册其包名且可安全销毁（HMR 重新注册）。

## 备选方案

- **把输出风格加进 agent 主循环**——否决：把模型可见的呈现选择耦合进主循环内部，违背插件架构；基于 seam 的形式只增加一个命名 section 与命令，而不改动 `agent-loop`。
- **复制 Claude Code 的内建 prompt 文本**——否决：本包镜像外部约定；为 harness 撰写专属散文保持 prompt 模型可见，避免引入外部厂商的逐字措辞。
- **静默跳过格式错误的自定义风格文件**——否决：否则沟通契约损坏会一直不可见，直到模型出问题；加载期明显失败能立刻暴露误配置。
- **每次切换都重新注册 section**——否决：不必如此，section 文本提供器已在每次组装读取实时选择，切换只需 `system-prompt/change` 通知来触发重组装。
- **`keep-coding-instructions: false` 时注销 harness 编码指示 section**——否决：该槽位归属另一提供器；"取代"契约改以所贡献 section 的引导语表达。
- **塑造成 Service**——否决：改为注入 `systemPrompt` 与 `commands` 的函数插件，与命令生产方与 section 提供器模式一致（对照 `command-goal` 与 `persona`），且不引入无人读取的 `ctx` 服务。

## 后果

- 现在可按会话通过 settings 或 `/output-style` 选择一种命名、可随文件发布的沟通契约，并通过既有 `system-prompt/change` 保证贡献给下一个组装的提示词。
- 本包停留在既有 seam——`systemPrompt`、`commands` 与可选 `settings`——因此无需改动主循环，部署也可作为一个整体省略或替换它。
- 自定义文件使用 harness home（`~/.dsh`）而非 `~/.claude`；项目文件与 Claude Code 期望一致地位于 `<project>/.claude/output-styles/`，便于迁移，而 harness 侧目录遵循 harness home 约定。
- `keep-coding-instructions: false` 以所贡献 section 的引导语表达"取代"，而非真正的跨提供器抑制；完整取代 harness 自身编码指示提供器仍然暂缓。
- 插件作者的 `force-for-plugin` 风格（插件启用时自动应用）不在本行范围内，因此插件目前还不能强制组合采用某种风格。
