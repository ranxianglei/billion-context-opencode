# DESIGN - V1-only ref-tag normalization

- Task ID: `2026-08-13_v1-ref-tag-normalization`
- Home Repo: `billion-context-opencode`
- Created: 2026-08-13
- Status: Accepted

## 1. Problem Statement

- **What problem are we solving?** The V1 converter currently copies kernel-prefixed ACP tags directly into both user and assistant text parts, which can encourage tag echo and displace user text from the start of the message.
- **Why now?** PR #2 predates the monorepo and dual-shape refactor and must be refreshed without extending an unverified assumption to V2.

## 2. Goals & Non-Goals

- **Goals**:
  - Keep V1 assistant history free of rendered ACP tags.
  - Append V1 user tags after the body.
  - Preserve kernel body mutations during V1 reassembly.
  - Keep the original tag-etiquette wording on V1 only.
- **Non-Goals**:
  - No V2 adapter behavior changes.
  - No changes to kernel rendering or ref allocation.

## 3. Current Architecture

- **How it works today**: V1 parts are projected to kernel cores; the kernel prefixes visible refs; `reassemble` copies the resulting core text back to the original V1 text part.
- **Pain points**: Role-specific rendering and body/tag ordering cannot be expressed by blindly copying the core text.

## 4. Proposed Architecture

- **Overview**: Keep kernel processing unchanged, then normalize only V1 text during reassembly.
- **Key components**:
  - A strict XML ref-tag matcher for kernel-generated leading tags.
  - A V1 reassembly helper that omits assistant tags, appends user tags, and honors changed core bodies for either role, including empty rewrites.
  - A V1-only system-hook suffix containing the unchanged tag-etiquette text.
- **Data flow**: `V1 host message -> CoreMessage -> kernel -> V1 patchRefTag -> V1 host message`.
- **API / interface changes**: None.

## 5. Design Decisions & Rationale

| Decision | Options Considered | Chosen | Why |
|----------|--------------------|--------|-----|
| Scope | Apply to both converters; V1 only | V1 only | Only the V1 host contract has been locally verified. |
| Assistant handling | Copy tag; relocate tag; omit rendered tag | Omit rendered tag | Avoids giving the model tag-shaped assistant examples while refs remain allocated in kernel state. |
| Prompt placement | Shared core prompt; V1 system hook | V1 system hook | Prevents V1-specific behavior from being asserted to V2. |
| Legacy `[mNNNNN]` parsing | Treat as a tag; preserve as text | Preserve as text | The adapter never generated that form, so stripping it risks user-content loss. |

## 6. Impact Analysis

- **Backward compatibility**: The dual-shape export, call/result pairing invariant, and persisted state are unchanged. Only V1 text presentation changes.
- **Performance**: One small regex match and string comparison per surviving V1 text part.
- **Security**: Strict matching avoids stripping arbitrary user prefixes.
- **Dependencies**: No new packages.

## 7. Migration Plan

- **Steps**:
  1. Refresh the old PR on a standards-compliant branch from current `master`.
  2. Add V1-only regression tests and run all repository checks.
  3. Replace PR #2 and close the superseded PR after review.
- **Feature flags / gradual rollout**: Not required.

## 8. Open Questions

- [ ] Maintainer runtime confirmation on OpenCode V1 after merge.
