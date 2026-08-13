# REQ — V2 tool-shape & idempotent system prompt (dual-shape)

## Problem

The dual-shape V2 path in `packages/billion-context-opencode/src/index.ts` (`setupV2`) registered the four `bili_*` tools by spreading `@bili/core`'s V1 `ToolDef` straight into `tools.add()`. The V1 `ToolDef` is `{ description, args(zod), execute(args, ToolContext) }`, but opencode V2's `tools.add()` expects the AI-SDK shape `{ name, description, input(JSON Schema), execute(input, ctx) → { content } }`. Concretely broken:

1. **No `name`** on the registered tool (V1 derives the name from the `tool:{}` map key; V2 needs it on the object).
2. **`args` is a zod object**, not a JSON Schema — V2's `Info.input` is a JSON Schema / ValueSchema, so the model never saw a usable schema.
3. **`execute` ctx unmapped** — V1 `ToolContext` requires `directory`/`worktree`/`messageID`/`agent` as non-optional strings; V2 provides `{ sessionID, agent?, messageID?, id, progress? }` (no `directory`/`worktree`).

Separately, the V2 context hook's system-prompt upsert used `SYSTEM_MARKER = "BILI CONTEXT MANAGEMENT"`, but `@bili/core`'s `SYSTEM_PROMPT` actually begins with `ACP TOOLS (billion-context)`. So `findIndex` always returned `-1` and a **duplicate system prompt was appended on every dispatch**.

Both bugs were reported in PR #8 (branch `fix/v2-tools`, by rorshopping), which fixed them inside a **separate second package** `packages/v2/` (`billion-context-opencode-v2`). That packaging contradicts AGENTS.md §2.3 (dual-shape is load-bearing; master deliberately has a single package). The fixes are correct; the packaging is not.

## Acceptance criteria

1. The four V2 tools registered by `setupV2` carry `{ name, description, input(JSON Schema), execute }`.
2. The V2 `input` schema is derived from each tool's zod `args` so it cannot drift.
3. V2 `execute` maps the V2 ctx onto the V1 `ToolContext` and returns `{ content }`.
4. `SYSTEM_MARKER` matches the real `SYSTEM_PROMPT` header; the upsert is idempotent.
5. A regression test guards both invariants.
6. `npm run typecheck`, `npm test`, `npm run build`, `node smoke.mjs` all pass.
7. No change to the V1 path, the dual-shape export, or `@bili/core`. No new runtime dependency.

## Constraints

- AGENTS.md §2.3: keep ONE package, ONE dual-shape entry. Do NOT add `packages/v2/`.
- AGENTS.md §2.7: published `dist/index.js` stays zero-runtime-dependency.
- Credit the fix logic to rorshopping (PRs #4 / #8); supersede both.
