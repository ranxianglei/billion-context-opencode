# DESIGN - V1 reported usage for nudge calculations

- Task ID: `2026-08-13_v1-reported-usage`
- Home Repo: `billion-context-opencode`
- Created: 2026-08-13
- Status: Accepted

## 1. Problem Statement

V1 receives a provider token-usage snapshot on assistant messages but currently sends only a tokenizer estimate to the kernel. The snapshot must be used when it is demonstrably valid and current, while the framework-agnostic core and V2 path remain unchanged.

## 2. Goals & Non-Goals

- **Goals**:
  - Extract and validate the newest OpenCode V1 assistant usage snapshot in the host adapter.
  - Reject snapshots from summary/error assistants, a different current model, or before/at the latest compression block.
  - Prefer the reported total over the estimate for V1; make status reuse the exact transform result through the existing turn cache.
- **Non-Goals**:
  - V2 usage support, kernel changes, provider-name conversion, or a persistent usage cache.

## 3. Current Architecture

The V1 message transform converts OpenCode messages to kernel `CoreMessage[]`, estimates tokens, calls `processTurn`, stores the state/cores/result in `AcpRuntime`, and reassembles messages. `bili_status` independently estimates tokens before trying to reuse the cached turn.

## 4. Proposed Architecture

```text
V1 messages
   │
   ├─ octoToCoreMessages ──► cores ──► estimateTokens (always)
   │
   └─ latestReportedUsage + current model + compression timestamps
                                  │
                  valid snapshot? ── yes ──► reported total
                                  │ no
                                  └──────────► estimate
                                                   │
                                      processTurn(tokenCount)
                                                   │
                         cache state + cores + modelLimit + tokenCount + turn
                                                   │
                              status exact-input cache hit? ──► reuse turn/count
                                                               else estimate
```

The host helper returns provenance (`assistant id/time/model`, five components, total, or a fallback reason). `AcpRuntime` stores only the final turn inputs/result in its existing per-session cache. Cache validity remains reference-based for state/cores and adds the resolved model limit; no usage snapshot is retained separately.

## 5. Design Decisions & Rationale

| Decision | Options Considered | Chosen | Why |
|---|---|---|---|
| Reported vs estimate | max of both; always estimate; reported with fallback | reported with fallback | Matches PI's real-value-first principle and avoids inflating a valid smaller provider total. |
| Host boundary | Put OpenCode types in `@bili/core`; host helper | host helper | Keeps the core framework-agnostic and V2-independent. |
| Latest assistant | array position; timestamp and id | timestamp, then id | Compaction can reorder the message array. |
| Stale compression | persistent fingerprint/usage map; block timestamp check | block timestamp check | Uses existing state, has no new lifecycle or persistence burden, and restores automatically with a newer assistant. |
| Status consistency | independent usage cache; recompute estimate; existing turn cache | existing turn cache with model limit + final count | Avoids a second cache and invalidates naturally on state/cores/model changes. |

## 6. Impact Analysis

- **Backward compatibility**: Compression state JSON is unchanged. V1/V2 dual-shape export and tool call/result pairing are untouched. Cache entries are in-memory only and old entries simply miss after code reload.
- **Performance**: One linear assistant scan and five-number validation per V1 transform; status avoids a duplicate kernel turn when inputs match.
- **Security**: Untrusted host metadata is treated as invalid unless strictly finite/non-negative and model-matching.
- **Dependencies**: No new packages.

## 7. Migration Plan

1. Deploy the V1 adapter change; existing state files remain readable.
2. If the provider omits/changes usage fields, the helper falls back to the existing estimate.
3. V2 remains estimate-based until a stable usage interface is verified.

## 8. Open Questions

- OpenCode's provider snapshot can lag behind newly appended user/tool content; this accepted V1 limitation is documented in the PR body.
