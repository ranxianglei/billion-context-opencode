# WORKLOG - Align the shared system prompt with PI

- Task ID: `2026-08-13_system-prompt-align`
- Home Repo: `billion-context-opencode`
- Status: Done
- Updated: 2026-08-13

## 1. Summary

- **What was done**: Expanded the current shared prompt with PI's four verbatim kernel rule constants, accurate OpenCode tool guidance, and four focused regression tests.
- **Why**: Refresh PR #5 on the current monorepo and align the shared prompt with PI without hiding the kernel tool-name mismatch.
- **Behavior / compatibility changes**: The static shared system prompt grows; runtime APIs and state are unchanged.
- **Risk level**: Medium

## 2. Change Log

### Commits

| Commit | Description |
|--------|-------------|
| This PR | Shared prompt alignment and focused regression tests |

### Key Files

- `packages/core/src/system-prompt.ts` — embed the complete kernel rules and host-neutral OpenCode guidance.
- `packages/billion-context-opencode/tests/system-prompt.test.ts` — verify verbatim constants, tool modes, accurate host-neutral claims, and deliberate non-adaptation of the generic kernel tool name.
- `devlog/2026-08-13_system-prompt-align/REQ.md` — record scope, constraints, and acceptance criteria.

## 3. Design & Implementation Notes

- **Entry point / key function**: `SYSTEM_PROMPT` in `packages/core/src/system-prompt.ts`.
- **Key configuration items**: `acp-kernel@0.0.19`; no configuration changes.
- **Key logic explanation**: Import and interpolate the four kernel constants verbatim; keep surrounding OpenCode instructions accurate for both host paths.

## 4. Testing & Verification

### Build & Test Commands

```sh
npm run typecheck
npm run test
npm run build
bash scripts/ci/check-pr.sh 2026-08-13_system-prompt-align upstream/master
```

### Test Coverage

- New/modified test files: `packages/billion-context-opencode/tests/system-prompt.test.ts`.
- Test count: 30 total, 30 pass, 0 fail (four new prompt cases).
- Key scenarios verified: Four kernel constants verbatim exactly once; four `bili_` guides and supported modes, including single-message decompression; accurate protected-output, host-neutral tag, and threshold claims; generic kernel `` `compress` `` remains unchanged.

### Results

- **PASS/FAIL**: `npm run typecheck` PASS; `npm run test` PASS (30/30); `npm run build` PASS; `scripts/ci/check-pr.sh` PASS; `git diff --check` PASS.
- **Key logs/data**: Rendered prompt is 15,261 characters (~3,815 chars/4 estimate). Each of the four kernel constants occurs once; the kernel marker `When you call \`compress\`,` occurs once and the adapted `bili_compress` form occurs zero times.
- **Independent review**: Two separate review agents approved after adversarial checks corrected the protected-output wording and restored the documented single-message decompression mode.

## 5. Risk Assessment & Rollback

- **Risk points**: Prompt size and the explicit unresolved `compress` / `bili_compress` name mismatch.
- **Rollback method**:
  - Revert commit(s): the eventual change commit.
  - Rollback impact: Restores the shorter prompt; no persisted data changes.
- **Compatibility notes**: No changes to dual-shape export, V1/V2 converters, persisted state, configuration schema, or tool definitions.

## 6. Lessons Learned

- Shared prompts must avoid claims that are true for one host message shape but not the other.
- Verbatim kernel prompt reuse preserves upstream wording but also preserves its generic tool name; this is an explicit known limitation, not something this PR silently rewrites.

## 7. Follow-ups

- [ ] After this prompt PR is merged, investigate a separate OpenCode adapter PR for exact, fail-closed kernel tool-name adaptation if runtime evidence warrants it.
