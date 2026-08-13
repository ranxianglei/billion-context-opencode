# WORKLOG - Repair the root smoke harness

- Task ID: `2026-08-13_fix-smoke-harness`
- Home Repo: `billion-context-opencode`
- Status: Done
- Updated: 2026-08-13

## 1. Summary

- **What was done**: Repaired the root smoke bundle path, removed its destructive shared-cache reset, and made its compression boundary independent of assistant tag presentation.
- **Why**: Restore the documented post-build check while keeping it safe and compatible with the intentional V1 behavior in PR #12.
- **Behavior / compatibility changes**: Test harness only; no package or runtime behavior changes.
- **Risk level**: Low

## 2. Change Log

### Commits

| Commit | Description |
|--------|-------------|
| Pending | Repair root smoke harness |

### Key Files

- `smoke.mjs` - load the monorepo bundle, use a visible fallback boundary, and clean up only the smoke session state.
- `devlog/2026-08-13_fix-smoke-harness/` - task requirements and verification record.

## 3. Design & Implementation Notes

- **Entry point / key function**: Root `smoke.mjs` executed after `npm run build`.
- **Key configuration items**: None.
- **Key logic explanation**: Current master exposes an assistant ref, while PR #12 intentionally omits it. The smoke uses the assistant ref when present and otherwise the following user ref, so it tests the tool pipeline rather than enforcing presentation behavior already covered by converter unit tests.

## 4. Testing & Verification

### Build & Test Commands

```sh
npm run typecheck
npm run test
npm run build
node smoke.mjs
bash scripts/ci/check-pr.sh 2026-08-13_fix-smoke-harness upstream/master
git diff --check
```

### Test Coverage

- New/modified test files: `smoke.mjs`.
- Test count: 26 total, 26 pass, 0 fail.
- Key scenarios verified: The built bundle loads; current-master assistant refs are usable; with PR #12 stacked, the missing assistant ref falls back to the next user ref; compression, status, search, and decompression complete in both cases; the smoke-created state file is removed without touching other sessions.

### Results

- **PASS**: `npm run typecheck`, `npm run test` (26/26), `npm run build`, `node smoke.mjs`, PR validation, and `git diff --check`; a detached PR #12 + smoke-fix compatibility build/smoke also passed.

## 5. Risk Assessment & Rollback

- **Risk points**: The fallback boundary includes the next user message when assistant refs are intentionally hidden.
- **Rollback method**: Revert the smoke-only commit.
- **Compatibility notes**: No changes to dual-shape export, persisted state format, or config schema.
