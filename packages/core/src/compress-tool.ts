import { z } from "zod"
import {
  estimateTokens,
  collectCoveredMessageIds,
} from "./tokens.js"
import type { AcpRuntime } from "./runtime.js"
import { debug } from "./log.js"

export interface ToolContext {
  sessionID: string
  messageID: string
  callID?: string
  agent: string
  directory: string
  worktree: string
}

export type ToolDef = {
  description: string
  args: Record<string, z.ZodTypeAny>
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string | { output: string; metadata?: Record<string, unknown> }>
}

function formatK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)
}

const rangeShape = {
  startId: z.string().describe('Message ref, e.g. "m00005" (from the bili tag), or a block id "b3".'),
  endId: z.string().describe("Inclusive end ref. Must be at or after startId."),
  summary: z.string().describe("Complete technical summary replacing all content in range. Keep only essential details (conclusions, file paths, signatures, decisions, exact values)."),
  topic: z.string().optional().describe("Short label (3-5 words) for THIS range. Omit to use top-level topic."),
}

/** Parsed shape of one entry in `content`, after zod validation. Shared by
 *  execute() and handleCompress() so the two don't drift on the field set. */
interface CompressRangeInput {
  startId: string
  endId: string
  summary: string
  topic?: string
}

export function makeCompressTool(runtime: AcpRuntime): ToolDef {
  return {
    description:
      "Replace older conversation ranges with detailed summaries you write. Single range: bili_compress({ content: [{ startId, endId, summary }] }). Batch multiple ranges: bili_compress({ content: [{ topic, startId, endId, summary }, ...] }) — each entry gets its own block.",
    args: {
      topic: z.string().optional().describe("Fallback topic for entries without their own."),
      content: z.array(z.object(rangeShape)).describe("One or more ranges to compress, each with start/end boundaries and a summary."),
      summaryMaxChars: z.number().optional().describe("Override max summary length (default 20000). Use when content needs more detail."),
    },
    async execute(args, ctx) {
      const ranges = (args.content as CompressRangeInput[] | undefined) ?? []
      if (ranges.length === 0) return "No ranges provided."
      return runtime.acquireLock(ctx.sessionID, () =>
        handleCompress(args, runtime, ctx),
      )
    },
  }
}

async function handleCompress(
  args: Record<string, unknown>,
  runtime: AcpRuntime,
  ctx: ToolContext,
): Promise<string> {
  const ranges = (args.content as CompressRangeInput[] | undefined) ?? []
  const state = await runtime.stateFor(ctx.sessionID)
  const cores = runtime.getCores(ctx.sessionID) ?? []
  const resolved = runtime.configFor(runtime.getModelLimit(ctx.sessionID) ?? 0)

  const beforeTokens = estimateTokens(cores, collectCoveredMessageIds(state))
  const summaryMaxChars = args.summaryMaxChars as number | undefined
  const topLevelTopic = args.topic as string | undefined

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
      compressCallId: ctx.callID ?? ctx.messageID,
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
  return lines.join("\n")
}
