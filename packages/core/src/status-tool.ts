import { z } from "zod"
import { buildStatusReport, defaultCountTokens, formatRanges } from "acp-kernel"
import { viableRanges } from "billion-context-kit"
import type { AcpRuntime } from "./runtime.js"
import type { ToolDef } from "./compress-tool.js"
import { estimateTokens, collectCoveredMessageIds } from "./tokens.js"

export function makeStatusTool(runtime: AcpRuntime): ToolDef {
  return {
    description:
      "Context status: overview, compressed blocks, or uncompressed ranges/messages. No args = overview + totals + compressible ranges. scope:'uncompressed' + view:'messages' for per-message listing. scope:'compressed' for block drilldown.",
    args: {
      scope: z.enum(["compressed", "uncompressed"]).optional().describe('"compressed" = drill into blocks; "uncompressed" = show visible messages/ranges. Default: overview.'),
      view: z.enum(["ranges", "messages"]).optional().describe('For uncompressed scope: "ranges" (default) or "messages".'),
      tool: z.string().optional().describe('Filter by tool name (e.g. "bash", "read"). uncompressed+messages only.'),
      sort: z.enum(["size", "time", "tool", "age"]).optional().describe("Sort order. Default: size."),
      limit: z.number().optional().describe("Max items to show (default 30)."),
    },
    async execute(args, ctx) {
      return runtime.acquireLock(ctx.sessionID, () => handleStatus(args, runtime, ctx))
    },
  }
}

async function handleStatus(args: Record<string, unknown>, runtime: AcpRuntime, ctx: { sessionID: string }): Promise<string> {
  const state = await runtime.stateFor(ctx.sessionID)
  const cores = runtime.getCores(ctx.sessionID) ?? []
  const resolved = runtime.configFor(runtime.getModelLimit(ctx.sessionID) ?? 0)

  // Reuse the transform hook's exact result and final token count when state,
  // cores, and model limit still match. This is the only path by which status
  // sees V1 provider usage; otherwise it deliberately falls back to text
  // estimation because status has no host message snapshot.
  const cached = runtime.getCachedTurnForInputs(ctx.sessionID, state, cores, resolved)
  const tokenCount = cached?.tokenCount ?? estimateTokens(cores, collectCoveredMessageIds(state))
  const turn =
    cached?.result ??
    runtime.core.processTurn({
      messages: cores,
      state,
      config: resolved.kernel,
      tokenCount,
      renderTags: "text-only",
    })

  const base = buildStatusReport(turn.state, turn.messages, defaultCountTokens, {
    scope: args.scope as "compressed" | "uncompressed" | undefined,
    view: args.view as "ranges" | "messages" | undefined,
    tool: args.tool as string | undefined,
    sort: args.sort as "size" | "time" | "tool" | "age" | undefined,
    limit: args.limit as number | undefined,
  })

  if (args.scope) return base

  const nudge = turn.nudge
  // Kit filter: fragmented ranges (<200 tokens) cannot carry a meaningful
  // summary and would fail the kernel's atomic batch validation — same guard
  // as the omp/pi adapters (billion-context-kit viableRanges).
  const ranges = viableRanges(nudge?.compressibleRanges ?? [])
  const protectedRanges = nudge?.protectedRanges ?? []

  const extra: string[] = []
  if (nudge) {
    extra.push("")
    extra.push(nudge.shouldInject ? `Nudge: ACTIVE — ${nudge.reason}` : `Nudge: idle — ${nudge.reason}`)
  }
  if (ranges.length > 0 || protectedRanges.length > 0) {
    extra.push("")
    extra.push(formatRanges(ranges, protectedRanges))
  }
  return extra.length > 0 ? `${base}\n${extra.join("\n")}` : base
}
