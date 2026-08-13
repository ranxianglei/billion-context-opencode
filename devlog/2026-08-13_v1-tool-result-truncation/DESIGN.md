# DESIGN - V1 Tool Result Body Round Trip

- Task ID: `2026-08-13_v1-tool-result-truncation`
- Home Repo: `billion-context-opencode`
- Created: 2026-08-13
- Status: Accepted

## 1. Problem Statement

- **What problem are we solving?** The V1 converter projects a tool result into a mutable kernel core, but reassembly currently discards any kernel rewrite and restores the original host part verbatim.
- **Why now?** The old V1-only fix predates the monorepo and dual-shape refactor. It must be migrated deliberately to the current V1 converter without treating the unverified V2 host contract as equivalent.

## 2. Goals & Non-Goals

- **Goals**:
  - Make V1 tool-result projection and writeback use the same state-aware body mapping.
  - Preserve completed, ordinary error, and interrupted error state semantics.
  - Preserve the call/result pairing invariant and all non-body host fields.
- **Non-Goals**:
  - Do not change or infer behavior for `messages-v2.ts`.
  - Do not change the shared runtime, kernel, dual-shape entry, persisted state, or provider-facing schemas.

## 3. Current Architecture

- **How it works today**:

  ```text
  V1 OctoPart
      -> octoToCoreMessages (tool-call core + optional tool-result core)
      -> acp-kernel (may rewrite tool-result text)
      -> reassemble (checks pair, restores original OctoPart)
  ```

- **Pain points**: The final step observes only whether the result core survived. It does not project a changed result body back into the V1 host shape, so emergency truncation is lost.

## 4. Proposed Architecture

- **Overview**:

  ```text
  V1 state --toolResultBody--> tool-result core
                                   |
                              kernel rewrite
                                   |
                         applyToolBody by original state
                                   |
              output | error | metadata.output on V1 state
  ```

- **Key components**:
  - `toolResultBody`: the single V1 projection rule used for comparison and core construction.
  - `applyToolBody`: a state-preserving copy-on-change writeback used only after both halves of a tool pair survive.
- **Data flow**:
  - Completed: `state.output` -> core text -> `state.output`.
  - Ordinary error: adapter projection `Error: ${state.error}` -> core text -> `state.error`, removing one adapter-added prefix.
  - Interrupted error with string partial output: `state.metadata.output` -> core text -> `state.metadata.output`.
- **API / interface changes**: Extend the internal structural `OctoPart.state` type with optional `metadata: Record<string, unknown>`. No exported package entry, configuration, or persistence API changes.

## 5. Design Decisions & Rationale

| Decision | Options Considered | Chosen | Why |
|----------|--------------------|--------|-----|
| Scope | Update V1 and V2; update V1 only | V1 only | The V1 host shape is locally verified; this task does not claim an unverified V2 runtime contract. |
| Error representation | Store core text in `output`; preserve state-specific fields | Preserve state-specific fields | OpenCode consumes ordinary errors from `state.error` and interrupted partial output from `state.metadata.output`. |
| Unchanged bodies | Always clone; compare trailing-whitespace-normalized bodies | Normalize trailing whitespace and return original | Avoids needless mutation when formatting differs but the body does not. |
| Missing or empty result core | Clear host body; keep original part | Keep original part | The kernel truncation rewrite is non-empty; missing/empty input is not evidence that host state should be erased. |

## 6. Impact Analysis

- **Backward compatibility**: The dual-shape export and persisted state are untouched. The existing call/result pairing check remains the gate before writeback. Status and other state fields are retained with object spreads.
- **Performance**: One body projection and trailing-whitespace comparison per surviving terminal V1 tool part; linear in result body length and only on reassembly.
- **Security**: No new I/O, dependencies, parsing, or privilege boundaries.
- **Dependencies**: No new packages required.

## 7. Migration Plan

- **Steps**:
  1. Add the state-aware V1 projection helper and internal metadata type.
  2. Route existing terminal result projection through it.
  3. Apply changed core bodies during V1 reassembly after the pair-survival check.
  4. Add converter tests for completed, whitespace-equivalent, ordinary error, and interrupted error cases.
- **Feature flags / gradual rollout**: None. Unchanged bodies retain the original part reference; the changed path is limited to kernel result rewrites.

## 8. Open Questions

- [ ] V2 may need an analogous fix after its real host message and hook contracts can be validated; it is intentionally deferred from this change.
