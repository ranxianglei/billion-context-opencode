# REQ - Repair the root smoke harness

- Task ID: `2026-08-13_fix-smoke-harness`
- Home Repo: `billion-context-opencode`
- Created: 2026-08-13
- Status: Done
- Priority: P1
- Owner: 5258MF
- References: root `smoke.mjs`; PR #12

## 1. Background & Problem Statement

- **Context**: The monorepo build emits the public bundle under `packages/billion-context-opencode/dist/`, while the root smoke harness still uses the pre-monorepo bundle path.
- **Current behavior (symptom)**: `npm run build && node smoke.mjs` fails before loading the plugin. If the path is corrected locally, the harness assumes assistant ref tags are always visible and recursively deletes the user's entire ACP cache before running.
- **Expected behavior**: The root smoke loads the actual bundle, exercises compression with whichever visible boundary is available, and cleans up only the state file created by its unique session.
- **Impact**: Contributors can run the documented end-to-end check without stale path failures, coupling to V1 ref presentation, or loss of local plugin state.

## 2. Reproduction

- **Environment**: Node 22/24; any supported OS.
- **Minimal reproduction steps**:
  1. Run `npm run build` from the repository root.
  2. Run `node smoke.mjs` and observe that `./dist/index.js` does not exist.

## 3. Constraints & Non-Goals

- **Constraints**:
  - Do not change package source, public APIs, persisted state schemas, or plugin behavior.
  - Keep the smoke compatible with both current master and V1 assistant-tag omission from PR #12.
- **Non-Goals**: Real OpenCode process coverage, V2 behavior changes, or replacing the planned e2e harness.

## 4. Acceptance Criteria

- **Correctness**:
  - [x] The smoke imports the bundle produced by `npm run build`.
  - [x] Compression/search/decompression complete whether or not the assistant exposes a ref tag.
  - [x] The smoke never recursively deletes the shared ACP cache.
- **Regression**:
  - [x] `npm run typecheck`, `npm run test`, `npm run build`, and `node smoke.mjs` pass.

## 5. Proposed Approach

- Update the root harness path, select the assistant ref with a user-ref fallback, and remove only the unique smoke session state file.
- **Rollback strategy**: Revert the smoke-only commit; no application or state migration is involved.
