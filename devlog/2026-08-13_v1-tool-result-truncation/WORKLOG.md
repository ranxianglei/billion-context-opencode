# WORKLOG - Preserve V1 Tool Result Truncation

- Task ID: `2026-08-13_v1-tool-result-truncation`
- Home Repo: `billion-context-opencode`
- Status: Done
- Updated: 2026-08-13 11:30 +08:00

## 1. Summary

- **What was done**: Migrated the old tool-result writeback fix into the current V1 converter only, with state-aware handling for completed, ordinary error, and interrupted error results. Added four focused V1 converter tests.
- **Why**: Kernel emergency truncation rewrites the result core, but V1 reassembly previously restored the original full host part.
- **Behavior / compatibility changes**: Yes. Only a changed V1 terminal tool-result body is copied back into its original body field. V2 is explicitly unchanged.
- **Risk level**: Medium

## 2. Change Log

### Commits

| Commit | Description |
|--------|-------------|
| This PR | V1 tool-result body writeback and regression coverage |

### Key Files

- `packages/billion-context-opencode/src/messages-v1.ts` - project and restore V1 result bodies by original state.
- `packages/billion-context-opencode/tests/messages.test.ts` - cover four V1 result writeback scenarios.
- `devlog/2026-08-13_v1-tool-result-truncation/REQ.md` - record scope and acceptance criteria.
- `devlog/2026-08-13_v1-tool-result-truncation/DESIGN.md` - document the V1-only converter data flow and deliberate V2 exclusion.

## 3. Design & Implementation Notes

- **Entry point / key function**: `octoToCoreMessages`, `reassemble`, `toolResultBody`, and `applyToolBody` in `messages-v1.ts`.
- **Key configuration items**: No adapter configuration changes. Kernel emergency truncation remains governed by its existing threshold.
- **Key logic explanation**: Projection and comparison share the same result-body helper. Changed bodies are copied into `output`, `error`, or `metadata.output` according to the original V1 status; object spreads retain the host state envelope.

## 4. Testing & Verification

### Build & Test Commands

```sh
# From repo root
npm run typecheck
npm run test
npm run build
node smoke.mjs
bash scripts/ci/check-pr.sh 2026-08-13_v1-tool-result-truncation upstream/master
```

### Test Coverage

- New/modified test files: `packages/billion-context-opencode/tests/messages.test.ts`
- Test count: 30 total, 30 pass, 0 fail (four new V1 converter cases)
- Key scenarios verified: Completed output rewrite; trailing-whitespace no-op and reference preservation; ordinary error rewrite with status/prefix handling; interrupted partial-output projection and metadata writeback.

### Results

- **PASS/FAIL**: `npm run typecheck` PASS; `npm run test` PASS (30/30); `npm run build` PASS; `scripts/ci/check-pr.sh` PASS; targeted kernel-to-V1 truncation round trip PASS.
- **Key logs/data**: A targeted check ran `acp-kernel` emergency truncation on a 12,010-character V1 completed result and verified that reassembly returned the 4,064-character marked result. `node smoke.mjs` could not start because the mainline script imports `dist/index.js`, while the current monorepo build writes `packages/billion-context-opencode/dist/index.js`. This pre-existing path mismatch is outside this V1 converter change and was not modified. The first typecheck attempt also ran before this fresh worktree had dependencies; after `npm ci`, typecheck passed.

## 5. Risk Assessment & Rollback

- **Risk points**:
  - The ordinary-error core contains one adapter-added `Error: ` prefix that must not be persisted back into the host error field.
  - Interrupted failures expose their model-visible partial result through `metadata.output`, not the ordinary error field.
  - A future V1 host schema change could require updating the internal structural type.
- **Rollback method**:
  - Revert commit(s): the eventual change commit.
  - Rollback impact: Restores prior behavior where kernel result rewrites are discarded; no persisted data migration is involved.
- **Compatibility notes**: The dual-shape export, V2 converter, call/result pairing invariant, configuration, and persisted state format are unchanged.

## 6. Lessons Learned

- The V1 and V2 adapters must be scoped and validated independently even though they share the same runtime.

## 7. Follow-ups

- [ ] Consider an independent V2 investigation only when its real host contract and integration path can be validated.
