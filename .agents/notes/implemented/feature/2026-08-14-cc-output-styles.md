# Agent Note: Claude Code-compatible output styles

Status: implemented

English | [中文](2026-08-14-cc-output-styles.zh.md)

## Problem

Claude Code users adopt a communication contract with the model through *output styles*: a named prose block that changes how the model explains and teaches (the built-in `Explanatory` and `Learning` styles), or an authored file in `output-styles/*.md` that supplies custom instructions. DeepSeek Harness has no equivalent — a deployment can set a persona, but there is no named, swappable "how the model communicates" contribution that a human can flip at runtime and that projects can ship as files.

Hardcoding these styles into the agent loop would violate the plugin architecture. The harness already owns the seams that make output styles composable: a system-prompt section registry with per-assembly evaluated text, an optional user-settings seam with a composition fallback, and a human command registry. The open question is whether those seams can reproduce the Claude Code surface — built-in styles, custom `output-styles/*.md` files with `keep-coding-instructions`, switching through settings and a `/output-style` command, and a reassembly trigger on switch — without touching the loop.

## Decision

`@deepseek-ai/dsh-cc-output-styles` in `packages/compat/cc-output-styles/` is a function plugin over `ctx.systemPrompt`, `ctx.commands`, and the optional `ctx.settings` seam. It composes three built-in styles (`default`, `Explanatory`, `Learning`), loads custom `output-styles/*.md` files, exposes the selection as a settings key with a composition fallback, and contributes one system-prompt section plus one command.

### Style model and built-ins

A style is `{ name, description, prompt, builtin, keepCodingInstructions }`. `default` contributes an empty prompt (and therefore no section). `Explanatory` directs the model to explain its implementation choices and codebase patterns; `Learning` directs it to teach collaboratively by requesting short practice contributions gated by a single `TODO(human)` marker. The prose is authored for this harness — aligned with Claude Code's semantics but not copied from it, since this package mirrors an external convention rather than vendoring its prompt text.

### Custom file loading

Custom styles load from `<project>/.claude/output-styles/*.md` and the harness home `~/.dsh/output-styles/*.md`, with the later project directory overriding a same-named earlier style. The file name (minus `.md`) is the style name — the authoritative identity per the "filename is the style name" rule. Frontmatter must supply a non-empty `description`; the optional `keep-coding-instructions` boolean (or `'true'`/`'false'` string) defaults to `true`. Malformed YAML, a non-object frontmatter, or a missing description fails the plugin load loud rather than being silently skipped, because a misconfigured communication contract is a configuration error, not an ignorable file.

### Selection and switching

The active style is the settings key `outputStyle` in the `cc-output-styles` namespace, layered over the plugin's composition `outputStyle` config through `installSettingsSection`. Without a settings provider the composition value stands. The `/output-style` command lists the current selection and available styles with no argument, and sets the selection with a name; an unknown name returns an error listing the available styles rather than mutating state. When a settings provider is present the command persists through it; otherwise it applies the switch in-session and re-emits `system-prompt/change`.

The plugin registers one system-prompt section `cc:output-style` at order `-50` (before the deployment persona at `0`, after the harness identity at `-100`) whose text provider reads the live selection at each assembly. Switching therefore re-emits `system-prompt/change`, causing the next assembled prompt to pick up the new style's section; the section is not re-registered on switch. A stored selection naming an unknown style degrades to the `default` empty section rather than failing assembly, since an externally edited document is not an actionable model-input error.

### keep-coding-instructions branch

When `keep-coding-instructions` is `true` (the default) the style's prose is contributed as-is alongside the default coding instructions. When `false`, the contributed section leads with a fixed statement that it replaces the default coding-instruction section before the style's own prose — expressed in the section text because this plugin does not own the coding-instruction provider's slot and must not unregister another seam's contribution.

## Testing

The package suite covers: built-in style content and distinctness; frontmatter parsing (name-from-filename, description, `keep-coding-instructions` booleans/strings/default, and fail-loud on missing frontmatter, malformed YAML, non-object frontmatter, empty frontmatter, and missing description); directory loading with later-wins override and missing-directory tolerance; library assembly with custom-over-builtin shadowing; the empty section for `default` and prose for built-in and custom styles; switching through the real settings provider emitting `system-prompt/change` and changing the live section; in-session switching without a settings provider; the `keep-coding-instructions` section-text branch; and the command's list, set, and unknown-name error paths. The invariant companion registers its package name and is disposal-safe (HMR re-registration).

## Alternatives considered

- **Add output styles to the agent loop** — rejected because it couples a model-facing presentation choice into loop internals, against the plugin architecture; the seam-based form adds a named section and command without modifying `agent-loop`.
- **Copy Claude Code's built-in prompt text** — rejected because this package mirrors an external convention; authoring harness-specific prose keeps the prompt model-visible and avoids importing a foreign vendor's exact wording.
- **Silently skip a malformed custom style file** — rejected because a broken communication contract would then be invisible until the model misbehaves; fails-loud at load surfaces the misconfiguration immediately.
- **Re-register the section on every switch** — rejected as unnecessary: the section text provider already reads the live selection per assembly, so a switch only needs the `system-prompt/change` notification to trigger reassembly.
- **Unregister the harness coding-instruction section when `keep-coding-instructions: false`** — rejected because that slot belongs to another provider; the "replaces" contract is expressed in the contributed section's lead-in instead.
- **Shape this as a Service** — rejected in favor of a function plugin injecting `systemPrompt` and `commands`, matching the command-producer and section-provider pattern (compare `command-goal` and `persona`) and avoiding a `ctx` service that nothing reads.

## Consequences

- A named, file-shippable communication contract is now selectable per session through settings or `/output-style`, and contributes to the next assembled prompt through the existing `system-prompt/change` guarantee.
- The package stays on existing seams — `systemPrompt`, `commands`, and optional `settings` — so no loop change is required and a deployment can omit or replace it as one effect.
- Custom files use the harness home (`~/.dsh`) rather than `~/.claude`; project files sit in `<project>/.claude/output-styles/` exactly as Claude Code expects, easing migration, while the harness-side directory follows the harness home convention.
- `keep-coding-instructions: false` expresses "replacement" as a lead-in in the contributed section rather than true cross-provider suppression; fully replacing the harness's own coding-instruction provider remains deferred.
- Plugin-author `force-for-plugin` styles (auto-applied when a plugin enables) are out of scope for this row, so a plugin cannot yet force a style on a composition.
