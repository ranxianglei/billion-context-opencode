# billion-context-opencode-v2

The [acp-kernel](https://github.com/ranxianglei/acp-kernel) compression pipeline,
wired into **OpenCode V2** (`opencode2`) as a plugin. Model-driven context
management: compress, decompress, search, and inspect compressed context blocks.

This is the **V2 adapter** of the [`billion-context-opencode`](https://github.com/ranxianglei/billion-context-opencode)
pattern. Same kernel, same tool set, built on the V2 plugin API
(`Plugin.define`, `ctx.session.hook("context")`, `ctx.tool.transform`) so it
runs on `opencode2` — V1 plugins do not load there.

Independent of `opencode-acp` — all tools are prefixed `bili_` and coexist
side-by-side with V1 plugins (`compress` / `bili_status`).

## Tools

| Tool | Description |
|------|-------------|
| `bili_compress` | Replace older conversation ranges with detailed summaries you write. |
| `bili_decompress` | Restore a compressed block's content (inline or to a file). |
| `bili_search` | Full-text search across compressed block summaries and historical messages. |
| `bili_status` | Context status: token breakdown, compressible ranges, nudge decision. |

Each message part carries an `<acp tokens="X" type="Y">mNNNNN</acp>` ref tag.
Pass the `mNNNNN` ref as `startId`/`endId` to `bili_compress`.

## Install

Load the plugin from an npm package or a local path via the `plugins` array in
`opencode.json` (project or global):

```jsonc
{
  "compaction": { "auto": false },
  "plugins": [
    "billion-context-opencode-v2"
  ]
}
```

For a local build:

```jsonc
{
  "compaction": { "auto": false },
  "plugins": [
    "./path/to/dist/index.js"
  ]
}
```

Verify it loaded:

```bash
opencode2 api get /api/plugin     # look for "billion-context-opencode-v2"
opencode2 run "Use the bili_status tool and report what it returns."
```

## Plugin options

```jsonc
{
  "plugins": [
    {
      "package": "billion-context-opencode-v2",
      "options": {
        "modelContextLimit": 200000,
        "preserveRecentMessages": 5,
        "protectedTools": [],
        "debug": false
      }
    }
  ]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `modelContextLimit` | auto (from model catalog) | Token limit used for nudge math. Env `BILI_MODEL_CONTEXT_LIMIT` overrides. |
| `preserveRecentMessages` | `5` | Recent messages always kept visible. |
| `protectedTools` | `[]` | Tool-result message ids never compressed. |
| `debug` | `false` | Verbose logging. Env `BILI_ACP_DEBUG=1` also enables. |
| `coreOverrides` | `{}` | Raw `acp-kernel` config overrides (advanced). |

State persists to `~/.cache/opencode-bili-acp/<session>.acp.json` (override with
`BILI_ACP_STATE_DIR`).

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # node --import tsx --test tests/*.test.ts
npm run build       # tsup bundle (acp-kernel inlined, zero runtime deps)
npm run smoke       # end-to-end check against dist (node, no model required)
```

## Architecture

```
src/
├── index.ts          # Plugin entry: registers tools + context hook
├── config.ts         # AdapterConfig -> kernel config (defers thresholds to kernel)
├── runtime.ts        # AcpRuntime: per-session state, lock, cores/model-limit cache
├── state.ts          # SessionStateStore: ~/.cache/opencode-bili-acp/<sid>.acp.json
├── messages.ts       # V2 host messages <-> kernel CoreMessage[] + reassembly
├── tokens.ts         # Token estimation, covered-message collection
├── search-index.ts   # SearchDoc[] builder (blocks + covered messages)
├── compress-tool.ts  # bili_compress
├── decompress-tool.ts# bili_decompress
├── search-tool.ts    # bili_search
├── status-tool.ts    # bili_status
├── system-prompt.ts  # Compression philosophy + tool guide
└── log.ts            # Debug logging
```

`acp-kernel` is bundled **inline** by tsup — `dist/index.js` is self-contained
with zero runtime dependencies (not even `@opencode-ai/plugin`; the plugin
exports `{ id, setup }` directly). The kernel is used unmodified via its public
API, preserving its independence and generality.

The V2 hook mapping (validated on `opencode2` v0.0.0-next-17276):

| Concern | V1 (`experimental.chat.*`) | V2 (this package) |
|---|---|---|
| System injection | `experimental.chat.system.transform` | `ctx.session.hook("context")` -> upsert system part |
| Message-range pruning | `experimental.chat.messages.transform` | same hook -> `event.messages` splice |
| Tools | `tool:` map | `ctx.tool.transform(tools.add)` with `codemode: false` |
| Model context limit | `input.model.limit.context` | `ctx.catalog.model.list()` lookup |

## License

MIT. Independent implementation built on `acp-kernel` (MIT); not derived from
`opencode-acp` (AGPL).
