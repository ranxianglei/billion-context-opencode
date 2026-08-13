# REQ - V1 reported usage for nudge calculations

- Task ID: `2026-08-13_v1-reported-usage`
- Home Repo: `billion-context-opencode`
- Created: 2026-08-13
- Status: Done
- Priority: P1
- Owner: 5258MF
- References: PR E (`feat(v1): prefer reported usage for nudge calculations`)

## 1. Background & Problem Statement

- **Context**: OpenCode V1 assistant messages expose the provider's latest token usage snapshot. The adapter currently drives the kernel only with a text/tokenizer estimate.
- **Current behavior (symptom)**: V1 nudge and growth calculations ignore a valid provider usage snapshot, while V2 has no verified stable usage contract.
- **Expected behavior**: V1 uses the newest valid, model-matching provider usage snapshot directly and falls back to the existing estimate when the snapshot is absent, invalid, stale, or from before compression. V2 remains estimate-based.
- **Impact**: V1 nudge timing and `bili_status` growth should follow the provider Meter when a trustworthy snapshot is available without changing the kernel or persisted state schema.

## 2. Reproduction (if applicable)

- **Environment**:
  - Node: 22/24
  - OS/Arch: Windows development host; CI Linux
- **Minimal reproduction steps**:
  1. Transform V1 messages containing an assistant `tokens` snapshot.
  2. Compare the token count sent to `processTurn` with the provider five-field total.
- **Relevant configuration**: Existing adapter options and kernel configuration; no new option.

## 3. Constraints & Non-Goals

- **Constraints**:
  - Keep `@bili/core` host-agnostic; OpenCode message types stay in the host adapter.
  - Preserve the V1/V2 dual-shape export, call/result pairing, persisted compression state, LRU behavior, and status output format.
  - A provider snapshot is the latest assistant request snapshot, not an exact next-request context total; trailing messages remain an accepted V1 limitation.
  - No independent usage cache or persistent usage state.
- **Non-Goals**:
  - Do not change V2 usage behavior.
  - Do not modify `acp-kernel` or implement provider-name conversion.
  - Do not claim that `CONTEXT BREAKDOWN` is provider Meter data; it remains text-estimate based.

## 4. Acceptance Criteria (must be testable)

- **Correctness**:
  - [ ] Sum input/output/reasoning/cache.read/cache.write only when every component is finite, non-negative, and the total is greater than zero.
  - [ ] Select the newest assistant by `time.created`, then `id`; reject summary/error/invalid/model-mismatched snapshots without falling back to an older assistant.
  - [ ] Reject a snapshot when any compression block was created at or after its assistant timestamp.
  - [ ] V1 uses `validReportedUsage ?? estimatedTokens`; V2 continues using the estimate.
  - [ ] `bili_status` reuses a transform's exact cached token count only when state, cores, and model limit still match.
- **Performance / Stability**:
  - [ ] No extra persistent state, usage Map, or change to the existing LRU/session lifecycle.
- **Regression**:
  - [ ] New/modified test cases added and passing (`npm run test`).

## 5. Proposed Approach

- **Affected modules & entry files**:
  - `packages/billion-context-opencode/src/messages-v1.ts` and new V1 usage helper: host snapshot types/extraction/freshness.
  - `packages/billion-context-opencode/src/index.ts`: V1-only selection and debug provenance; V2 estimate path unchanged.
  - `packages/core/src/runtime.ts`, `status-tool.ts`: extend the existing turn cache with model limit and expose the cached final token count.
  - `packages/billion-context-opencode/tests/`: usage, freshness, pipeline/cache coverage.
- **Risks**: OpenCode may omit usage/model fields or reorder compacted messages; all such cases must safely fall back to estimation.
- **Rollback strategy**: Revert the feature commit; no persisted schema migration is required.
