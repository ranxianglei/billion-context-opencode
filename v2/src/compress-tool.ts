import type { AcpRuntime } from "./runtime.js"
import { estimateTokens, collectCoveredMessageIds } from "./tokens.js"
import { debug } from "./log.js"

export interface V2ToolContext {
  sessionID: string
  agent?: string
  messageID?: string
  id?: string
  progress?: (update: Record<string, unknown>) => unknown
}

export interface V2ToolInfo {
  name: string
  description: string
  input: Record<string, unknown>
  execute(input: Record<string, unknown>, ctx: V2ToolContext): Promise<{ output?: unknown; content?: string | unknown[]; metadata?: Record<string, unknown> }>
  options?: { codemode?: boolean; permission?: string; namespace?: string }
}

function formatK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)
}

const rangeShape = {
  type: "object",
  properties: {
    startId: { type: "string", description: 'Message ref, e.g. "m00005" (from the bili tag), or a block id "b3".' },
    endId: { type: "string", description: "Inclusive end ref. Must be at or after startId." },
    summary: { type: "string", description: "Complete technical summary replacing all content in range. Keep only essential details (conclusions, file paths, signatures, decisions, exact values)." },
    topic: { type: "string", description: "Short label (3-5 words) for THIS range. Omit to use top-level topic." },
  },
  required: ["startId", "endId", "summary"],
} as const

export function makeCompressTool(runtime: AcpRuntime): V2ToolInfo {
  return {
    name: "bili_compress",
    description:
      "Replace older conversation ranges with detailed summaries you write. Single range: bili_compress({ content: [{ startId, endId, summary }] }). Batch multiple ranges: bili_compress({ content: [{ topic, startId, endId, summary }, ...] }) — each entry gets its own block.",
    input: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Fallback topic for entries without their own." },
        content: {
          type: "array",
          items: rangeShape,
          description: "One or more ranges to compress, each with start/end boundaries and a summary.",
        },
        summaryMaxChars: { type: "number", description: "Override max summary length (default 20000). Use when content needs more detail." },
      },
      required: ["content"],
    },
    async execute(args, ctx) {
      const ranges = Array.isArray(args.content) ? (args.content as { startId: string; endId: string; summary: string; topic?: string }[]) : []
      if (ranges.length === 0) return { content: "No ranges provided." }
      return runtime.acquireLock(ctx.sessionID, () => handleCompress(args, runtime, ctx))
    },
  }
}

async function handleCompress(args: Record<string, unknown>, runtime: AcpRuntime, ctx: V2ToolContext): Promise<{ content: string }> {
  const ranges = Array.isArray(args.content) ? (args.content as { startId: string; endId: string; summary: string; topic?: string }[]) : []
  const state = await runtime.stateFor(ctx.sessionID)
  const cores = runtime.getCores(ctx.sessionID) ?? []
  const resolved = runtime.configFor(runtime.getModelLimit(ctx.sessionID) ?? 0)

  const beforeTokens = estimateTokens(cores, collectCoveredMessageIds(state))
  const summaryMaxChars = typeof args.summaryMaxChars === "number" ? args.summaryMaxChars : undefined
  const topLevelTopic = typeof args.topic === "string" ? args.topic : undefined

  debug("compress-in", {
    sid: ctx.sessionID,
    ranges: ranges.length,
    spans: ranges.map((r) => `${r.startId}..${r.endId}`),
    blocksBefore: state.blocks.length,
    beforeTokens,
  })

  const applied = runtime.core.applyCompression({
    ranges: ranges.map((r) => ({
      startRef: r.startId,
      endRef: r.endId,
      summary: r.summary,
      topic: r.topic ?? topLevelTopic,
      summaryMaxChars,
      compressCallId: ctx.id ?? ctx.messageID,
    })),
    messages: cores,
    state,
    config: resolved.kernel,
  })
  await runtime.save(applied.state, ctx.sessionID)
  const { blocksCreated, tokensCompressed, errors, warnings } = applied.result
  const afterTokens = Math.max(0, beforeTokens - tokensCompressed)

  debug("compress-out", { sid: ctx.sessionID, blocksCreated, tokensCompressed, beforeTokens, afterTokens, errors: errors.length })

  const lines = [`bili ACP | ${formatK(beforeTokens)} → ${formatK(afterTokens)} tokens (~${formatK(tokensCompressed)} reclaimed, ${blocksCreated} block${blocksCreated > 1 ? "s" : ""})`]
  if (warnings.length > 0) lines.push("⚠️ " + warnings.join("; "))
  if (errors.length > 0) lines.push("Errors: " + errors.join("; "))
  return { content: lines.join("\n") }
}
