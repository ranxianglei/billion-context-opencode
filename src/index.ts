import { renderNudgeText } from "acp-kernel"
import type { CompressionState } from "acp-kernel"
import { AcpRuntime } from "./runtime.js"
import type { AdapterConfig } from "./config.js"
import { debug, warn } from "./log.js"
import {
  octoToCoreMessages,
  reassemble,
  makeNudgeMessage,
  deriveSessionId,
  type OctoMessage,
} from "./messages.js"
import { estimateTokens, collectCoveredMessageIds } from "./tokens.js"
import { makeCompressTool } from "./compress-tool.js"
import { makeDecompressTool } from "./decompress-tool.js"
import { makeSearchTool } from "./search-tool.js"
import { makeStatusTool } from "./status-tool.js"
import { SYSTEM_PROMPT } from "./system-prompt.js"

interface OctoModel {
  limit?: { context?: number }
}

interface TransformOutput {
  messages: OctoMessage[]
}

interface SystemTransformInput {
  sessionID?: string
  model?: OctoModel
}

interface SystemTransformOutput {
  system: string[]
}

interface OctoHooks {
  tool?: Record<string, unknown>
  "experimental.chat.system.transform"?: (input: SystemTransformInput, output: SystemTransformOutput) => Promise<void>
  "experimental.chat.messages.transform"?: (input: unknown, output: TransformOutput) => Promise<void>
}

interface PluginInput {
  [key: string]: unknown
}

export default async function biliAcpPlugin(
  _input: PluginInput,
  options: Record<string, unknown> = {},
): Promise<OctoHooks> {
  const adapter: AdapterConfig = {
    modelContextLimit: numOpt(options.modelContextLimit),
    protectedTools: strArrayOpt(options.protectedTools),
    preserveRecentMessages: numOpt(options.preserveRecentMessages),
    debug: boolOpt(options.debug),
    coreOverrides: options.coreOverrides as AdapterConfig["coreOverrides"],
  }

  if (adapter.debug) process.env.BILI_ACP_DEBUG = "1"

  const runtime = new AcpRuntime(adapter)

  const hooks: OctoHooks = {
    tool: {
      bili_compress: makeCompressTool(runtime),
      bili_decompress: makeDecompressTool(runtime),
      bili_search: makeSearchTool(runtime),
      bili_status: makeStatusTool(runtime),
    },

    "experimental.chat.system.transform": async (input, output) => {
      const ctx = input.model?.limit?.context
      if (ctx && ctx > 0 && input.sessionID) {
        // Per-session authoritative value. We deliberately do NOT keep a
        // cross-session fallback: in a multi-session process (subagents,
        // parallel sessions) reusing another session's limit leaks the wrong
        // threshold into a session's first turn — e.g. a 32K model B running
        // right after a 200K model A would inherit A's 200K threshold and skip
        // nudges it should fire. Instead, messages.transform resolves to
        // FALLBACK_LIMIT (200K, see config.ts) on the very first turn, before
        // this hook has recorded the per-session limit. That's the conservative
        // default for an unknown model and self-corrects on the next turn.
        runtime.setModelLimit(input.sessionID, ctx)
      }
      output.system.push(SYSTEM_PROMPT)
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      const msgs = output.messages
      const sessionID = deriveSessionId(msgs)
      if (!sessionID || msgs.length === 0) return
      try {
        await runtime.acquireLock(sessionID, () => runPipeline(msgs, sessionID, runtime, output))
      } catch (err) {
        warn("messages.transform failed:", err instanceof Error ? err.message : String(err))
      }
    },
  }

  return hooks
}

async function runPipeline(
  msgs: OctoMessage[],
  sessionID: string,
  runtime: AcpRuntime,
  output: TransformOutput,
): Promise<void> {
  const { cores, partIdToCoreIds } = octoToCoreMessages(msgs)
  const state: CompressionState = await runtime.stateFor(sessionID)

  const coveredIds = collectCoveredMessageIds(state)
  const tokenCount = estimateTokens(cores, coveredIds)
  // getModelLimit returns undefined on a session's first turn (before
  // system.transform records it). configFor(undefined) → FALLBACK_LIMIT.
  const resolved = runtime.configFor(runtime.getModelLimit(sessionID))
  debug("transform-in", { sid: sessionID, msgs: msgs.length, cores: cores.length, tokens: tokenCount, limit: resolved.modelContextLimit, blocks: state.blocks.length })

  const turn = runtime.core.processTurn({
    messages: cores,
    state,
    config: resolved.kernel,
    tokenCount,
    renderTags: "text-only",
  })

  runtime.setCores(sessionID, cores)
  // Cache this turn so bili_status (and any other status read) can reuse it
  // without recomputing the pipeline. setCores above already invalidated any
  // prior entry; cache the fresh one after cores are stored.
  runtime.cacheTurn(sessionID, turn.state, cores, tokenCount, turn)
  await runtime.save(turn.state, sessionID)

  const reassembled = reassemble(turn.messages, msgs, partIdToCoreIds, sessionID)

  if (turn.nudge && turn.nudge.shouldInject) {
    const rendered = renderNudgeText(turn.nudge)
    const text = [rendered.voice ? `[${rendered.voice}]` : "", rendered.text].filter(Boolean).join("\n")
    reassembled.push(makeNudgeMessage(`bili_nudge_${turn.nudge.tier ?? 0}_${Date.now()}`, sessionID, text, msgs))
    debug("nudge-injected", { sid: sessionID, tier: turn.nudge.tier, reason: turn.nudge.reason })
  }

  // opencode calls this hook with a bare wrapper `{ messages: msgs }` and
  // ignores the returned/assigned value. Reassigning `output.messages` alone
  // (a new array) is invisible to the caller, so the request is never shrunk.
  // Rebuild the *same* array in place instead.
  msgs.splice(0, msgs.length, ...reassembled)
  output.messages = reassembled
  debug("transform-out", { sid: sessionID, outMsgs: reassembled.length, nudge: !!turn.nudge?.shouldInject })
}

function numOpt(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined
  if (typeof v === "string" && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}
function strArrayOpt(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map(String) : undefined
}
function boolOpt(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined
}
