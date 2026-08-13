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

## Install

Published on npm as [`billion-context-opencode`](https://www.npmjs.com/package/billion-context-opencode) — opencode installs it on demand, no path needed:

```jsonc
// opencode.json
{
  "compaction": { "auto": false },
  "plugin": ["billion-context-opencode"]
}
```

## Clean test environment

A clean opencode instance that loads **only** this plugin (no pollution from other compression plugins) via an isolated `XDG_CONFIG_HOME`:

```bash
./test-clean/run.sh                         # npm version (default)
PLUGIN=$PWD/../dist/index.js ./test-clean/run.sh   # local build instead
```

This disables opencode's built-in compaction and registers only the four `bili_` tools.

## Plugin options

```jsonc
{
  "plugin": [
    {
      "id": "billion-context-opencode",
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

## Changelog

### v0.1.0 — Monorepo + dual-shape single package (PR #7, #9)

Initial npm-workspaces monorepo: `@bili/core` (private) + `billion-context-opencode` (published).
One dual-shape entry loads on opencode V1 (callable) and V2 (`.id`/`.setup`) via `Object.assign`.
