# REQ - Release v0.1.1

- Task ID: `2026-08-15_release-v0.1.1`
- Home Repo: `billion-context-opencode`
- Created: 2026-08-15
- Status: Done
- Priority: P1
- Owner: ranxianglei
- References: `packages/billion-context-opencode/package.json`; PR #20

## 1. Background & Problem Statement

- **Context**: npm still serves `billion-context-opencode@0.1.0` while master has accumulated 22 commits since the last release: five contributor fixes (#12–#16), the v2 AI-SDK tool shape (#18), and the viability filter + kit npm pin (#19).
- **Current behavior (symptom)**: users installing from npm miss the ref-tag normalization, truncated tool-result preservation, reported-usage nudges, and viable-range filtering.
- **Expected behavior**: `billion-context-opencode@0.1.1` on npm containing all merged master work.

## 2. Requirements

- R1: `packages/billion-context-opencode/package.json` version 0.1.0 → 0.1.1 (the only published package; `@bili/core` stays private).
- R2: `acp-kernel` stays at 0.0.19 this release — the 0.0.19→0.0.24 jump crosses the prompts-interface + truncation API surface and is deferred to a dedicated PR.
- R3: README changelog gains a `### v0.1.1` entry (required by check-pr.sh when the version changes).

## 3. Acceptance Criteria

- AC1: workspace typecheck clean, 54/54 tests, build green.
- AC2: pr-validation passes (devlog REQ+WORKLOG present; README changelog updated).
- AC3: merge of the release branch triggers the Release workflow (tag v0.1.1 + npm publish).
