# REQ - Filter status compressible ranges via billion-context-kit

- Task ID: `2026-08-15_viable-ranges`
- Home Repo: `billion-context-opencode`
- Created: 2026-08-15
- Status: Done
- Priority: P2
- Owner: 5258MF
- References: `packages/core/src/status-tool.ts`; PR #19

## 1. Background & Problem Statement

- **Context**: The sibling adapters (billion-context-omp, billion-context-pi) hit a production failure mode: the nudge/status recommendation lists can contain fragmented ranges (e.g. a 16-token one-message ack). A model that batches the whole list into one compress call gets atomically rejected by acp-kernel — `minSummaryLength` (50 chars) cannot be satisfied by a tiny range, and the kernel validates the batch as a whole. omp issue evidence: 14-range list containing a 16-token range, every batch attempt failed.
- **Current behavior (symptom)**: `packages/core/src/status-tool.ts` lists `nudge.compressibleRanges` unfiltered, so sub-viability fragments are recommended to the model/user.
- **Expected behavior**: every surface that recommends ranges (this PR: the status tool) applies the shared viability floor from `billion-context-kit` (`viableRanges`, `VIABLE_RANGE_MIN_TOKENS = 200`).

## 2. Requirements

- R1: `status-tool.ts` compressible list is filtered by `viableRanges` before rendering.
- R2: No kernel bump — opencode stays on acp-kernel 0.0.19; the kit's `viableRanges` has no kernel dependency, so pulling the kit does not change kernel semantics.
- R3: The kit dependency is an exact pin (build-time, bundled inline); transitional git pin `git+https#v0.1.1` now swapped to npm `0.1.1` after publication.

## 3. Non-Goals

- Adopting the kit panel (`buildStatusPanel`) — larger surface, follow-up when the repo stabilizes.
- Filtering the nudge injection itself (omp/pi do this in their adapters; opencode's nudge path is host-side and out of scope here).

## 4. Acceptance Criteria

- AC1: `npm run typecheck --workspaces` and `npm test` (54/54) pass.
- AC2: Status output contains no compressible range below 200 tokens.
