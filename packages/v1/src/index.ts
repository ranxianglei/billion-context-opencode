import { renderNudgeText } from "acp-kernel"
import type { CompressionState } from "acp-kernel"
import {
  AcpRuntime,
  type AdapterConfig,
  debug,
  warn,
  estimateTokens,
  collectCoveredMessageIds,
  makeCompressTool,
  makeDecompressTool,
  makeSearchTool,
  makeStatusTool,
  SYSTEM_PROMPT,
  numOpt,
  strArrayOpt,
  boolOpt,
} from "@bili/core"
import {
  octoToCoreMessages,
  reassemble,
  makeNudgeMessage,
  deriveSessionId,
  type OctoMessage,
} from "./messages.js"

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
  runtime.cacheTurn(sessionID, turn.state, cores, tokenCount, turn)
  await runtime.save(turn.state, sessionID)

  const reassembled = reassemble(turn.messages, msgs, partIdToCoreIds, sessionID)

  if (turn.nudge && turn.nudge.shouldInject) {
    const rendered = renderNudgeText(turn.nudge)
    const text = [rendered.voice ? `[${rendered.voice}]` : "", rendered.text].filter(Boolean).join("\n")
    reassembled.push(makeNudgeMessage(`bili_nudge_${turn.nudge.tier ?? 0}_${Date.now()}`, sessionID, text, msgs))
    debug("nudge-injected", { sid: sessionID, tier: turn.nudge.tier, reason: turn.nudge.reason })
  }

  msgs.splice(0, msgs.length, ...reassembled)
  output.messages = reassembled
  debug("transform-out", { sid: sessionID, outMsgs: reassembled.length, nudge: !!turn.nudge?.shouldInject })
}
