# WORKLOG — V2 tool-shape & idempotent system prompt (dual-shape)

## Branch

`2026-08-13_v2-tools-dualshape` (off `origin/master` @ `16463b5`, after #13 merged).

## Origin of the fix

PRs #4 (rorshopping, root `v2/`) and #8 (ranxianglei branch `fix/v2-tools`, `packages/v2/`) both target V2. #8 fixes two real bugs (tool shape, system-prompt marker) but as a **second package**, which contradicts AGENTS.md §2.3. This PR ports #8's fixes into the existing dual-shape entry and supersedes both. Fix logic credited to rorshopping.

## Changes

- **NEW** `packages/billion-context-opencode/src/v2-tools.ts`
  - `toV2Tool(name, tool)` wraps a V1 `ToolDef` → `{ name, description, input, execute }`.
  - `input = z.toJSONSchema(z.object(tool.args))` (zod 4.4.3 built-in) — drift-free.
  - `execute` maps V2 ctx → V1 `ToolContext` (`callID ← ctx.id`, empty `directory`/`worktree`) and unwraps result → `{ content }`.
  - `makeV2{Compress,Decompress,Search,Status}Tool(runtime)`.
- `packages/billion-context-opencode/src/index.ts`
  - `SYSTEM_MARKER`: `"BILI CONTEXT MANAGEMENT"` → `"ACP TOOLS (billion-context)"` (matches `@bili/core` SYSTEM_PROMPT header at `system-prompt.ts:14`). Now `export`ed.
  - `setupV2` `tools.add` block: `makeCompressTool` → `makeV2CompressTool` (×4). V1 path unchanged.
- **NEW** `packages/billion-context-opencode/tests/v2-tools.test.ts` — 4 tests:
  1. all four tools expose `{ name, description, input{type:"object",properties}, execute }`;
  2. compress input schema projects content[].{startId,endId,summary}, required=["content"];
  3. execute maps ctx + returns `{ content: string }` (exercised via `bili_status`);
  4. `SYSTEM_PROMPT.includes(SYSTEM_MARKER)` (idempotency invariant).

## Verification

| Check | Result |
|------|--------|
| `npm run typecheck` (both workspaces) | ✅ pass |
| `npm test` | ✅ **54/54** (50 → 54, +4 V2 tests) |
| `npm run build` | ✅ pass (`dist/index.js` 677.51 KB; +1 KB vs 676.5 — z.toJSONSchema is already in bundled zod) |
| `node smoke.mjs` | ✅ ALL SMOKE TESTS PASSED |
| `bash scripts/ci/check-pr.sh 2026-08-13_v2-tools-dualshape origin/master` | (runs in CI) |

## Follow-ups (out of scope)

- Close #4 and #8 once this merges (fixes incorporated into the canonical package).
- #8 notes the kernel hardcodes the generic tool name `'compress'` in pairing rules, leaking consumed `bili_compress` invocations — separate kernel-side fix (rorshopping has a PR-ready branch on `acp-kernel`).
- Live opencode2 runtime verification not in CI (same gap as #8).
