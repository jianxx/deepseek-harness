# Agent Note: Claude Code skill-format compatible loader provider

Status: implemented

## Problem

Claude Code ships thousands of installable `SKILL.md` skills in a stable directory and frontmatter format. DeepSeek Harness already owns a skill capability seam (`ctx.skills`, `@deepseek-ai/dsh-skill`) with a local filesystem provider (`@deepseek-ai/dsh-skill-filesystem`), but that provider's directory layout, frontmatter vocabulary, and activation model differ from Claude Code's. Consuming Claude Code skills directly requires a compatibility provider that fixes its discovery roots, parses its full frontmatter spec, and translates its semantic fields onto the harness's tool-scoping, subagent, and filesystem-touch seams.

## Decision

Add a new provider package `@deepseek-ai/dsh-skill-claude-code` that discovers and serves Claude Code-format skills through the existing `ctx.skills` registry, implemented with TDD against temporary-directory fixtures.

Discovery scans managed (optional), project (`.claude/skills` walking up to the `.git` root), user (`<dshHome>/skills`), and additional roots in that precedence order, recognizing only directory bundles `<name>/SKILL.md` plus legacy `.claude/commands/*.md` marked `deprecated`. Realpath deduplication keeps a symlinked or overlapping file served once.

Frontmatter parsing accepts every documented field (`description`, `name`, `allowed-tools`, `argument-hint`, `arguments`, `when_to_use`, `version`, `model` including `inherit`, `user-invocable`, `disable-model-invocation`, `context` including `fork`, `agent`, `effort`, `shell`, `hooks`, `paths`), tolerates unknown fields, and fails loudly at load for a known field with an invalid value. The catalog parses only frontmatter, so `estimateFrontmatterTokens` counts name, description, and `when_to_use` and never the body.

Semantic translation is served as parsed metadata plus pure helpers rather than applied automatically, because a provider holds no agent reference at load time: `ccRestriction` turns `allowed-tools` into an allow-only `tools.restrict()` filter, `ccPathMatcher`/`registerPathActivator` turn gitignore-style `paths` into an `fs/observed`-driven conditional activation, `ccInvocation` resolves `disable-model-invocation` and `user-invocable`, and `context: fork` surfaces as `metadata.executionContext` for a consumer to route to `ctx.subagents.start()`. `renderSkillBody` substitutes `$ARGUMENTS`, indexed and named placeholders, and `${CLAUDE_SKILL_DIR}`/`${CLAUDE_SESSION_ID}`, and extracts inline-shell `` !`...` `` commands for a caller to execute under an explicit `allowInlineShell` gate.

## Verification

Vitest runs five suites (37 tests) against temporary-directory fixtures and a wired `SkillRegistry`: frontmatter field parsing with unknown-field tolerance and bad-value throws, root ordering and realpath dedup plus legacy deprecation, argument/placeholder substitution and inline-shell segmentation, path-conditional activation on `fs/observed` filtered to read/write/edit actors, and end-to-end provider discovery and `get` through `ctx.skills`. Package `tsc --build` and `oxlint` pass clean.

## Alternatives considered

**Extend `dsh-skill-filesystem` with a Claude Code mode.** Rejected because the two formats differ too much in frontmatter vocabulary, directory layout, and activation semantics; a separate provider keeps each contract coherent and lets uniquely named providers coexist.

**Execute inline shell and fork subagents on behalf of the skill.** Rejected because a provider has no agent reference or `ctx.subagents` capability at load time; surfacing commands and `context: fork` as data for the composing consumer keeps the provider passive and the policy decisions with the caller.

## Consequences

Any directory containing Claude Code `SKILL.md` skills is now loadable by the harness with no format migration. The system prompt gains richer optional invocation and activation metadata, and the harness can route `allowed-tools` and `paths` controls at activation. The trade-off is that translation glue lives with the consumer (typically the agent composition), not the provider, so a skill's `allowed-tools` or `paths` are only enforced where a consumer explicitly applies them. Legacy `.claude/commands/*.md` files are served but flagged `deprecated`, preserving discoverability while signaling the older source.
