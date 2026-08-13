# REQ - Preserve V1 Tool Result Truncation

- Task ID: `2026-08-13_v1-tool-result-truncation`
- Home Repo: `billion-context-opencode`
- Created: 2026-08-13
- Status: Done
- Priority: P1
- Owner: 5258MF
- References: https://github.com/ranxianglei/billion-context-opencode/pull/3, `billion-context-pi/src/messages.ts`

## 1. Background & Problem Statement

- **Context**: The V1 adapter projects each completed or failed OpenCode tool part into a `tool-call` core and a `tool-result` core. At its emergency threshold, `acp-kernel` can replace the tool-result core text with a shortened body.
- **Current behavior (symptom)**: V1 reassembly checks that both halves of the tool pair survived, then restores the original tool part unchanged. The kernel's shortened result body is therefore discarded before OpenCode builds the model request.
- **Expected behavior**: Reassembly writes a changed kernel result body back to the V1 field consumed by OpenCode while preserving the original tool state and all non-body fields.
- **Impact**: Emergency truncation of large V1 tool results does not reduce the request body that reaches the model.

## 2. Reproduction

- **Environment**:
  - Node: 24.10.0
  - OS/Arch: Windows x64
- **Minimal reproduction steps**:
  1. Convert a V1 tool part with `octoToCoreMessages`.
  2. Replace the resulting `tool-result` core text as the kernel emergency truncation node does.
  3. Reassemble the cores and observe that the unmodified adapter returns the original V1 tool body.
- **Relevant configuration**: The production path is reached when `tokenCount >= truncate.threshold * modelContextLimit`; converter unit tests simulate only the deterministic kernel rewrite.

## 3. Constraints & Non-Goals

- **Constraints**:
  - Backward compatibility (dual-shape export, persisted state format): Do not change the dual-shape export, persisted state, or call/result survival invariant. Preserve the original V1 status, input, error, metadata, timing, and other state fields.
  - Performance requirements: Keep the normal path linear and return the original part reference when the body is unchanged modulo trailing whitespace.
  - Resource limits: Add no dependencies and do not alter kernel configuration.
- **Non-Goals**:
  - No changes to `messages-v2.ts` or claims about OpenCode V2 runtime behavior.
  - No changes to `acp-kernel`, prompt text, compression policy, or tool registration.
  - No handling for pending/running tool parts, because they have no V1 tool-result core in this conversion path.

## 4. Acceptance Criteria

- **Correctness**:
  - [x] A changed completed result body is written to `state.output`.
  - [x] A changed ordinary failure body is written to `state.error` without the adapter-added single `Error: ` prefix, and remains an error.
  - [x] A changed interrupted partial result is read from and written to `state.metadata.output`, while the interruption marker and original error remain intact.
  - [x] An unchanged body modulo trailing whitespace returns the original part unchanged.
- **Performance / Stability**:
  - [x] Tool call/result pairing remains unchanged.
  - [x] V2 adapter source remains unchanged.
- **Regression**:
  - [x] Four V1 converter tests are added and pass.
  - [x] `npm run typecheck`, `npm run test`, `npm run build`, and PR validation pass.

## 5. Proposed Approach

- **Affected modules & entry files**:
  - `packages/billion-context-opencode/src/messages-v1.ts`
  - `packages/billion-context-opencode/tests/messages.test.ts`
- **Risks**: Error results use an adapter-only display prefix in the core representation; writeback must remove exactly one such prefix. Interrupted failures must update partial output rather than overwrite their error message.
- **Rollback strategy**: Revert the source and four associated converter tests; no state migration or cleanup is needed.
