# REQ - Align the shared system prompt with PI

- Task ID: `2026-08-13_system-prompt-align`
- Home Repo: `billion-context-opencode`
- Created: 2026-08-13
- Status: Done
- Priority: P1
- Owner: 5258MF
- References: https://github.com/ranxianglei/billion-context-opencode/pull/5, `billion-context-pi/src/system-prompt.ts`

## 1. Background & Problem Statement

- **Context**: The OpenCode adapter uses `acp-kernel@0.0.19` but its persistent system prompt includes only `COMPRESS_PHILOSOPHY` plus a shortened adapter-authored guide. The mature PI adapter also embeds the kernel's complete compression, tier-2, and tier-3 rules.
- **Current behavior (symptom)**: Models receive limited guidance about historical summaries, search-before-decompress, detailed KEEP/DROP rules, multi-tier compression, block boundaries, and status-tool views.
- **Expected behavior**: The shared OpenCode prompt contains the same four kernel rule constants used by PI, plus accurate OpenCode-specific `bili_` tool instructions.
- **Impact**: Better summary fidelity and more reliable use of the existing compression, search, decompression, status, and multi-tier capabilities.

## 2. Reproduction

- **Environment**:
  - Node: 22 or 24
  - Dependency: `acp-kernel@0.0.19`
- **Minimal reproduction steps**:
  1. Inspect `packages/core/src/system-prompt.ts` on `master`.
  2. Observe that only `COMPRESS_PHILOSOPHY` is imported from the kernel.
  3. Compare it with PI's prompt and the exported kernel rule constants.
- **Relevant configuration**: The shared `SYSTEM_PROMPT` is injected by both V1 and V2 entry paths.

## 3. Constraints & Non-Goals

- **Constraints**:
  - Embed `COMPRESS_PHILOSOPHY`, `HOW_TO_COMPRESS_RULES`, `TIER2_DISTILL_RULES`, and `TIER3_CONDENSE_RULES` verbatim.
  - Keep adapter-authored text host-neutral because the prompt is shared by V1 and V2.
  - Add no dependencies and change no runtime behavior, tool schema, state, converter, or kernel configuration.
- **Non-Goals**:
  - Do not translate, alias, or replace the kernel's generic tool name `compress` with `bili_compress`.
  - Do not claim the `compress` / `bili_compress` naming mismatch is solved.
  - Do not modify `acp-kernel`, V1/V2 message conversion, or tool registration.

## 4. Acceptance Criteria

- **Correctness**:
  - [x] All four kernel constants appear verbatim and exactly once in `SYSTEM_PROMPT`.
  - [x] The prompt documents all four registered `bili_` tools and their key supported modes.
  - [x] Adapter-authored ACP-tag guidance does not promise role- or host-specific tag coverage.
  - [x] The prompt does not claim that the v0.0.19 nudge growth threshold adapts to model context size.
  - [x] Kernel text still contains its original `` `compress` `` wording; no tool-name conversion is introduced.
- **Performance / Stability**:
  - [x] Only the static shared prompt grows; converter, state, tool, and kernel behavior remain unchanged.
- **Regression**:
  - [x] Focused system-prompt tests and all repository checks pass.

## 5. Proposed Approach

- **Affected modules & entry files**:
  - `packages/core/src/system-prompt.ts`
  - `packages/billion-context-opencode/tests/system-prompt.test.ts`
- **Risks**: The kernel's generic `` `compress` `` name does not match the registered `bili_compress` tool. This pre-existing nudge mismatch becomes persistent when the full rule constant is embedded; the replacement PR must state this explicitly.
- **Rollback strategy**: Revert the prompt and its focused tests; no state or schema migration is required.
