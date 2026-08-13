# DESIGN — V2 tool-shape adapter (dual-shape)

## Context

`@bili/core`'s tool makers (`makeCompressTool`, etc.) return a V1 `ToolDef`:

```ts
type ToolDef = {
  description: string
  args: Record<string, z.ZodTypeAny>            // zod shape (V1 hosts consume this directly)
  execute(args, ctx: ToolContext): Promise<string | { output: string; metadata? }>
}
```

opencode V2's `tools.add()` wants the AI-SDK shape:

```ts
type V2ToolInfo = {
  name: string
  description: string
  input: Record<string, unknown>               // a JSON Schema
  execute(input, ctx): Promise<{ content: string }>
}
```

## Decision — derive the JSON Schema from zod (do not hand-write)

PR #8 hand-wrote four JSON Schemas mirroring the zod shapes. That works but **drifts**: any future edit to a tool's zod `args` must be mirrored by hand in the V2 schema, with no compiler help.

zod 4.4.3 (already a bundled dependency) ships `z.toJSONSchema(zodObject)`. We derive each tool's `input` from its own `args`:

```ts
input: z.toJSONSchema(z.object(tool.args))
```

The V2 schema is therefore **always a faithful projection of the V1 definition** — single source of truth, zero drift. This is strictly better than #8's hand-written schemas and is the reason this PR does not copy them verbatim.

## Decision — adapter module, not a second package

The bridge lives in a new sibling file `packages/billion-context-opencode/src/v2-tools.ts` (next to `messages-v1.ts` / `messages-v2.ts`), consumed only by `setupV2`. It:

- maps `V2ToolContext` → V1 `ToolContext` (`callID ← ctx.id`, `directory`/`worktree ← ""` since V2 has none and the bili_* tools key persistence off `sessionID` only),
- unwraps the V1 result (`string | { output }`) into V2's `{ content }`.

`@bili/core` already exports `ToolDef` and `ToolContext`, so the adapter imports them — `@bili/core` stays host-agnostic (it knows nothing of opencode V2).

This keeps the single published package and the dual-shape export untouched (AGENTS.md §2.3 / §2.7), unlike #8's `packages/v2/` second package.

## Decision — marker exported for a regression test

`SYSTEM_MARKER` is now `export`ed from `index.ts`. A test asserts `SYSTEM_PROMPT.includes(SYSTEM_MARKER)`, so any future edit to either side that breaks the match fails CI instead of silently reintroducing duplicate-prompt accumulation.

## What is NOT changed

- The dual-shape default export (`Object.assign(biliAcpPluginV1, { id, setup: setupV2 })`).
- The V1 plugin factory and its `tool:{}` map (still uses the raw V1 makers).
- `@bili/core` (V1 `ToolDef` untouched).
- `runPipelineV2` pipeline logic (nudge, reassemble, model-limit resolution) — identical to master; only the `tools.add` block and the marker constant change.

## Risk / limitation

The V2 tool shape is verified by unit test (shape, schema projection, ctx mapping, `{ content }` unwrap) but not against a live opencode2 runtime in this repo's CI (same limitation #8 had). `z.toJSONSchema` emits standard JSON Schema Draft 2020-12; if a future opencode2 `ValueSchema` rejects the `$schema` keyword, a one-line strip resolves it.
