# billion-context-opencode (v2 branch)

The [acp-kernel](https://github.com/ranxianglei/acp-kernel) compression pipeline
wired into **OpenCode V2 (opencode2)** as a plugin via `session.hook("context")`
and `tool.transform`. Model-driven context management with four tools:

| Tool | Purpose |
|------|---------|
| `bili_compress` | Replace older conversation ranges with detailed summaries (`<acp tokens=X type=Y>mNNNNN</acp>` tags). |
| `bili_decompress` | Restore a compressed block by id (inline or to file). |
| `bili_search` | Keyword-search compressed blocks (BM25/fuzzy/hybrid). |
| `bili_status` | Context usage report: tokens, blocks, tiers, growth. |

This branch targets **opencode 2.x only** (V1 API support lives on `main`).
Plugin id is `billion-context-opencode-v2` so it coexists with V1 plugins.

## Install (opencode2)

Point the plugin loader at this repo (or a local checkout):

```jsonc
// ~/.config/opencode/opencode.json
{ "plugin": ["github:ranxianglei/billion-context-opencode#v2"] }
```

or clone and reference the local path. Verify with `opencode2 api get /api/plugin`.

## Options

- `modelContextLimit` — auto from the model catalog; override with env `BILI_MODEL_CONTEXT_LIMIT`.
- `debug` — verbose pipeline logs; env `BILI_ACP_DEBUG=1`.
- `preserveRecentMessages`, `protectedTools`, `coreOverrides` — forwarded to acp-kernel.

Built-in opencode compaction should be disabled (`"compaction": { "auto": false }`).

## Kernel requirement

This branch pins `acp-kernel` to the **forked** kernel
(`github:rorshopping/acp-kernel#9666436`) because the released kernel hardcodes
the literal tool name `compress`; a host that registers the tool under a
different name (here `bili_compress`) had dead pairing/protection code and could
emit broken assistant tool-calls whose results were stripped (provider:
`invalid_request_error: assistant tool calls must be followed by matching tool
results`). The fork threads a configurable `compressToolName` through the whole
pipeline and is being upstreamed via PR to `ranxianglei/acp-kernel`. When it
publishes (≥ `0.0.20`), switch back to `"acp-kernel": "^0.0.20"`.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --import tsx --test tests/*.test.ts
npm run build       # tsup -> dist/index.js (acp-kernel bundled, zero runtime deps)
npm run smoke       # end-to-end plugin harness (also covers the tool-pairing fix)
```

The `.test-clean/` directory holds the probe harness used to verify the V2
context-event shape against a real opencode2 build.
