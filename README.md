# billion-context-opencode

The [acp-kernel](https://github.com/ranxianglei/acp-kernel) compression pipeline, wired into [opencode](https://opencode.ai) as a plugin. Model-driven context management: compress, decompress, search, and inspect compressed context blocks.

Independent implementation (modeled after `billion-context-pi`, the Pi adapter). Does **not** depend on or conflict with `opencode-acp` — all tools are prefixed `bili_`.

## Tools

| Tool | Description |
|------|-------------|
| `bili_compress` | Replace older conversation ranges with detailed summaries you write. |
| `bili_decompress` | Restore a compressed block's content (inline or to a file). |
| `bili_search` | Full-text search across compressed block summaries and historical messages. |
| `bili_status` | Context status: token breakdown, compressible ranges, nudge decision. |

Each message is tagged with an `<acp tokens="X" type="Y">mNNNNN</acp>` ref. Pass the `mNNNNN` ref as `startId`/`endId` to `bili_compress`.

## Install (local development)

```bash
git clone <repo> && cd billion-context-opencode
npm install
npm run build        # produces dist/index.js (self-contained, acp-kernel + zod inlined)
```

## Clean test environment

A clean opencode instance that loads **only** this plugin (no pollution from other compression plugins) via an isolated `XDG_CONFIG_HOME`:

```bash
./test-clean/run.sh
```

This disables opencode's built-in compaction and registers only the four `bili_` tools.

## Use in your own opencode config

Add to `opencode.json`:

```jsonc
{
  "compaction": { "auto": false },
  "plugin": ["/path/to/billion-context-opencode/dist/index.js"]
}
```

## Plugin options

```jsonc
{
  "plugin": [
    {
      "id": "/path/to/billion-context-opencode/dist/index.js",
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
| `modelContextLimit` | auto (from model) | Token limit used for nudge math. Env `BILI_MODEL_CONTEXT_LIMIT` overrides. |
| `preserveRecentMessages` | `5` | Recent messages always kept visible. |
| `protectedTools` | `[]` | Tool-result message ids never compressed. |
| `debug` | `false` | Verbose logging. Env `BILI_ACP_DEBUG=1` also enables. |
| `coreOverrides` | `{}` | Raw `acp-kernel` config overrides (advanced; nudge thresholds default to the kernel's own adaptive values). |

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # node --import tsx --test tests/*.test.ts
npm run build       # tsup bundle
node smoke.mjs      # end-to-end check against dist (run after build)
```

## Architecture

```
src/
├── index.ts          # Plugin entry: registers tools + transform hooks
├── config.ts         # AdapterConfig → kernel config (defers thresholds to kernel)
├── runtime.ts        # AcpRuntime: per-session state, lock, cores/model-limit cache
├── state.ts          # SessionStateStore: ~/.cache/opencode-bili-acp/<sid>.acp.json
├── messages.ts       # opencode msgs ↔ kernel CoreMessage[] conversion + reassembly
├── tokens.ts         # Token estimation, covered-message collection
├── search-index.ts   # SearchDoc[] builder (blocks + covered messages)
├── compress-tool.ts  # bili_compress
├── decompress-tool.ts# bili_decompress
├── search-tool.ts    # bili_search
├── status-tool.ts    # bili_status
├── system-prompt.ts  # Compression philosophy + tool guide
└── log.ts            # Debug logging
```

`acp-kernel` is bundled **inline** by tsup — `dist/index.js` is self-contained with zero runtime dependencies. The kernel is used unmodified via its public API, preserving its independence and generality.

## License

MIT
