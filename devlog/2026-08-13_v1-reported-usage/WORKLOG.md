# WORKLOG - V1 reported usage for nudge calculations

- Task ID: `2026-08-13_v1-reported-usage`
- Home Repo: `billion-context-opencode`
- Status: Done
- Updated: 2026-08-13

## 1. Summary

- **What was done**: Added strict V1 provider-usage extraction/freshness selection, wired reported-or-estimated token counts into the V1 transform, and made `bili_status` reuse the matching transform turn cache.
- **Why**: Prefer a trustworthy OpenCode provider snapshot for V1 nudge calculations while retaining safe estimation fallback and leaving V2 unchanged.
- **Behavior / compatibility changes**: Yes — V1 tokenCount source can now be provider-reported; persisted compression state and status output shape are unchanged.
- **Risk level**: Medium

## 2. Change Log

### Commits

| Commit | Description |
|--------|-------------|
| pending | Implementation and verification commit |

### Key Files

- `packages/billion-context-opencode/src/usage-v1.ts` — strict latest-assistant usage extraction, model matching, compression freshness, and V1 selection.
- `packages/billion-context-opencode/src/messages-v1.ts` — internal V1 assistant usage/model/summary/error and tool metadata types.
- `packages/billion-context-opencode/src/index.ts` — V1 reported-or-estimated pipeline and cache calls; V2 remains estimate-based.
- `packages/core/src/runtime.ts` — existing turn cache now records resolved config/model limit and exposes final tokenCount for exact-input status reuse.
- `packages/core/src/status-tool.ts` — status cache lookup before text-estimate fallback.
- `packages/billion-context-opencode/tests/usage-v1.test.ts` — usage validation, ordering, mismatch, freshness, and source preference coverage.
- `packages/billion-context-opencode/tests/runtime-cache.test.ts` — config/state/cores cache matching and lifecycle invalidation coverage.

## 3. Design & Implementation Notes

- **Entry point / key function**: `runPipelineV1` calls `selectV1TokenCount`; `AcpRuntime.getCachedTurnForInputs` serves status.
- **Key configuration items**: No new options; V1 uses `validReportedUsage ?? estimatedTokens`, V2 always uses `estimatedTokens`.
- **Key logic explanation**: The newest assistant is selected by `(time.created, id)` independent of array order. Its five usage components must all be finite and non-negative with a positive total. Summary/error/invalid/model-mismatched snapshots and snapshots not newer than all compression blocks fall back without reusing older usage.

## 4. Testing & Verification

### Build & Test Commands

```sh
npm run typecheck
npm test
npm run build
"$GIT_BASH" scripts/ci/check-pr.sh 2026-08-13_v1-reported-usage upstream/master
git diff --check
```

### Test Coverage

- New/modified test files: `tests/usage-v1.test.ts`, `tests/runtime-cache.test.ts`.
- Test count: 38 total, 38 pass, 0 fail.
- Key scenarios verified: strict five-field sum, zero components, invalid values, summary/error, timestamp/id ordering, no stale fallback, model mismatch, compression invalidation/restoration, reported value on either side of estimate, cache config/state/cores matching, dropSession and LRU eviction.

### Results

- **PASS**: `npm run typecheck`, `npm test`, `npm run build`, `git diff --check`.
- **PASS**: PR validation after adding this required WORKLOG.
- **Review**: Two independent agents reviewed the implementation. One found and prompted the invalid-timestamp stale-usage fix; the follow-up test and fix now pass all checks. The second found no blocking contract issue.

## 5. Risk Assessment & Rollback

- **Risk points**: Provider snapshots lag trailing user/tool content; missing or changed host fields safely fall back to estimation. Cache entries are reference/config guarded.
- **Rollback method**: Revert the implementation commit; no persisted migration is needed.
- **Compatibility notes**: No persisted `CompressionState` schema change; V1/V2 dual-shape export and tool call/result pairing remain untouched.

## 6. Follow-ups

- [ ] Obtain a stable V2 provider-usage interface or fixture before adding V2 usage support.
- [ ] Re-run combined tests if PR A/B/C changes later create conflicts.
