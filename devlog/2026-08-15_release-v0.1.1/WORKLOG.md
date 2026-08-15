# WORKLOG - Release v0.1.1

- Task ID: `2026-08-15_release-v0.1.1`
- Home Repo: `billion-context-opencode`
- Status: Done
- Updated: 2026-08-15

## 1. Summary

- **What was done**: version bump of the single published package (`billion-context-opencode` 0.1.0 → 0.1.1) carrying all merged master work since the initial release, plus the mandatory devlog and README changelog entries.

## 2. Changes

- `packages/billion-context-opencode/package.json`: version 0.1.1.
- `devlog/2026-08-15_release-v0.1.1/{REQ,WORKLOG}.md`: this devlog.
- `README.md`: `### v0.1.1` changelog entry (ships #12–#16, #18, #19).

## 3. Verification

- `npm run typecheck` (workspaces): clean.
- `npm test`: 54/54 pass.
- `npm run build`: ESM build success (dist/index.js + sourcemap).

## 4. Notes / Follow-ups

- acp-kernel upgrade (0.0.19 → 0.0.24) deliberately deferred: 5-version jump crosses prompts-interface + truncation API surface; deserves its own PR with the e2e harness.
