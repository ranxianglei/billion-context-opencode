# WORKLOG - Filter status compressible ranges via billion-context-kit

- Task ID: `2026-08-15_viable-ranges`
- Home Repo: `billion-context-opencode`
- Status: Done
- Updated: 2026-08-15

## 1. Summary

- **What was done**: Wired `billion-context-kit`'s `viableRanges` (>=200-token floor) into the status tool's compressible-range list, and pinned the kit dependency to the published npm version (`0.1.1`, was the transitional `git+https#v0.1.1`).

## 2. Changes

- `packages/core/package.json`: devDependency `billion-context-kit@0.1.1` (exact pin, bundled inline at build time).
- `packages/core/src/status-tool.ts`: `compressibleRanges` passed through `viableRanges()` before rendering.
- `package-lock.json` refreshed via `npm install --package-lock-only -w packages/core`.

## 3. Verification

- `npm run typecheck --workspaces`: clean.
- `npm test`: 54/54 pass.
- CI: build matrix (22/24) green; pr-validation initially failed on the missing devlog entry (this entry) — added, retriggered.

## 4. Notes

- acp-kernel intentionally stays at 0.0.19: `viableRanges` is a pure function with no kernel dependency, so no kernel semantics change rides along.
- The 200-token floor matches the sibling adapters (omp PR #20/#15, pi PR #148) — all three now share the same viability rule from one source.
