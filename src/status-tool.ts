import { buildStatusReport, defaultCountTokens, formatRanges } from "acp-kernel"
import type { AcpRuntime } from "./runtime.js"
import type { V2ToolInfo, V2ToolContext } from "./compress-tool.js"
import { estimateTokens, collectCoveredMessageIds } from "./tokens.js"

export function makeStatusTool(runtime: AcpRuntime): V2ToolInfo {
  return {
    name: "bili_status",
    description:
      "Context status: overview, compressed blocks, or uncompressed ranges/messages. No args = overview + totals + compressible ranges. scope:'uncompressed' + view:'messages' for per-message listing. scope:'compressed' for block drilldown.",
    input: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["compressed", "uncompressed"], description: '"compressed" = drill into blocks; "uncompressed" = show visible messages/ranges. Default: overview.' },
        view: { type: "string", enum: ["ranges", "messages"], description: 'For uncompressed scope: "ranges" (default) or "messages".' },
        tool: { type: "string", description: 'Filter by tool name (e.g. "bash", "read"). uncompressed+messages only.' },
        sort: { type: "string", enum: ["size", "time", "tool", "age"], description: "Sort order. Default: size." },
        limit: { type: "number", description: "Max items to show (default 30)." },
      },
    },
    async execute(args, ctx) {
      return runtime.acquireLock(ctx.sessionID, () => handleStatus(args, runtime, ctx))
    },
  }
}

async function handleStatus(args: Record<string, unknown>, runtime: AcpRuntime, ctx: V2ToolContext): Promise<{ content: string }> {
  const state = await runtime.stateFor(ctx.sessionID)
  const cores = runtime.getCores(ctx.sessionID) ?? []
  const resolved = runtime.configFor(runtime.getModelLimit(ctx.sessionID) ?? 0)

  const tokenCount = estimateTokens(cores, collectCoveredMessageIds(state))
  const turn =
    runtime.getCachedTurn(ctx.sessionID, state, cores, tokenCount) ??
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

  if (args.scope) return { content: base }

  const nudge = turn.nudge
  const ranges = nudge?.compressibleRanges ?? []
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
  return { content: extra.length > 0 ? `${base}\n${extra.join("\n")}` : base }
}
