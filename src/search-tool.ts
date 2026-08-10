import { z } from "zod"
import { searchBlocks } from "acp-kernel"
import type { AcpRuntime } from "./runtime.js"
import type { ToolDef } from "./compress-tool.js"
import { buildSearchDocs } from "./search-index.js"

export function makeSearchTool(runtime: AcpRuntime): ToolDef {
  return {
    description:
      "Search compressed blocks AND historical messages by keyword. Use to cheaply locate detail before decompressing. Returns ranked results with ref, size, preview, and the bili_decompress command to retrieve full content.",
    args: {
      query: z.string().describe("Keywords to locate detail folded into compressed summaries or historical messages."),
      limit: z.number().optional().describe("Max results (default 10)."),
    },
    async execute(args, ctx) {
      return runtime.acquireLock(ctx.sessionID, () => handleSearch(args, runtime, ctx))
    },
  }
}

async function handleSearch(args: Record<string, unknown>, runtime: AcpRuntime, ctx: { sessionID: string }): Promise<string> {
  const state = await runtime.stateFor(ctx.sessionID)
  const cores = runtime.getCores(ctx.sessionID) ?? []
  const docs = buildSearchDocs(state, cores)
  const msgCount = docs.filter((d) => d.kind === "message").length
  const blockCount = docs.filter((d) => d.kind === "block").length
  const query = String(args.query)
  const results = searchBlocks(docs, query, { limit: args.limit as number | undefined })

  if (results.length === 0) {
    return `No matches for "${query}" across ${state.blocks.length} block(s) and ${msgCount} historical message(s).`
  }

  const lines = [`Found ${results.length} match(es) for "${query}" (searched ${blockCount} blocks + ${msgCount} messages):`]
  for (const r of results) lines.push("", formatResult(r))
  return lines.join("\n")
}

function formatResult(r: ReturnType<typeof searchBlocks>[number]): string {
  const sizeStr = r.tokens != null ? formatSize(r.tokens) : ""
  const meta = [
    r.kind === "message" ? `message ${r.ref}` : `block ${r.ref}`,
    r.role ? `(${r.role})` : "",
    `T${r.tier}`,
    `score:${r.score.toFixed(2)}`,
    sizeStr,
  ]
    .filter(Boolean)
    .join(" ")

  const header = `${meta}  "${truncate(r.title, 50)}"`
  const decompressHint =
    r.kind === "block"
      ? `→ bili_decompress({ blockId: "${r.ref}" })`
      : r.blockId
        ? `→ bili_decompress({ blockId: "${r.blockId}" })  (block containing message ${r.ref})`
        : `(message ${r.ref} is still visible in context)`

  return `${header}\n  ${r.preview}\n  ${decompressHint}`
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + "…"
}

function formatSize(tokens: number): string {
  if (tokens < 1000) return `${tokens}tok`
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}
