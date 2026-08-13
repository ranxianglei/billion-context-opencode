# WORKLOG - Normalize V1 ref-tag placement

- Task ID: `2026-08-13_v1-ref-tag-normalization`
- Home Repo: `billion-context-opencode`
- Status: Done
- Updated: 2026-08-13

## 1. Summary

- **What was done**: Migrated PR #2's ref-tag normalization into the current V1 converter, and moved its unchanged tag-etiquette wording to the V1 system hook.
- **Why**: Refresh PR #2 on the current monorepo while explicitly limiting host behavior changes to V1.
- **Behavior / compatibility changes**: Yes, V1 presentation of ACP tags changes; V2 is untouched.
- **Risk level**: Medium

## 2. Change Log

### Commits

| Commit | Description |
|--------|-------------|
| This PR | V1-only ref-tag normalization and regression coverage |

### Key Files

- `packages/billion-context-opencode/src/messages-v1.ts` — normalize surviving V1 text parts during reassembly.
- `packages/billion-context-opencode/src/index.ts` — append the unchanged tag-etiquette wording only in the V1 system hook.
- `packages/billion-context-opencode/tests/messages.test.ts` — cover four V1 tag/body scenarios.
- `devlog/2026-08-13_v1-ref-tag-normalization/DESIGN.md` — document the V1-only data flow and V2 exclusion.

## 3. Design & Implementation Notes

- **Entry point / key function**: `reassemble` in `messages-v1.ts`.
- **Key configuration items**: `renderTags: "text-only"` remains unchanged.
- **Key logic explanation**: See `DESIGN.md`.

## 4. Testing & Verification

### Build & Test Commands

```sh
npm run typecheck
npm run build
npm run test
node smoke.mjs
bash scripts/ci/check-pr.sh 2026-08-13_v1-ref-tag-normalization upstream/master
```

### Test Coverage

- New/modified test files: `packages/billion-context-opencode/tests/messages.test.ts`.
- Test count: 30 total, 30 pass, 0 fail (four new V1 converter cases).
- Key scenarios verified: Assistant tag omission; user suffix placement; user/assistant/empty kernel body rewrites; literal `[mNNNNN]` preservation.

### Results

- **PASS/FAIL**: `npm run typecheck` PASS; `npm run test` PASS (30/30); `npm run build` PASS; `scripts/ci/check-pr.sh` PASS; targeted V1 built-bundle smoke PASS.
- **Key logs/data**: The repository's root `smoke.mjs` cannot start on current `master` because it imports `dist/index.js`, while the monorepo build writes `packages/billion-context-opencode/dist/index.js`. A targeted V1 smoke loaded the actual bundle and verified the V1 prompt, user suffix tag, and untagged assistant. The unrelated root smoke path was not changed.

## 5. Risk Assessment & Rollback

- **Risk points**: V1 text reconstruction and tag parsing.
- **Rollback method**:
  - Revert commit(s): the eventual change commit.
  - Rollback impact: Restores leading tags on V1 messages; no persisted data changes.
- **Compatibility notes**: Dual-shape export, V2 converter, persisted state, and config schema are unchanged.

## 6. Lessons Learned

- Host-specific behavior should not be inferred across V1 and V2 solely because the adapters share a runtime.

## 7. Follow-ups

- [ ] Validate against a real OpenCode V1 conversation after maintainer review.
