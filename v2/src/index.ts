import { renderNudgeText } from "acp-kernel"
import type { CompressionState } from "acp-kernel"
import { AcpRuntime } from "./runtime.js"
import type { AdapterConfig } from "./config.js"
import { debug, warn } from "./log.js"
import {
  v2ToCoreMessages,
  reassemble,
  makeNudgeMessage,
  type V2Message,
} from "./messages.js"
import { estimateTokens, collectCoveredMessageIds } from "./tokens.js"
import { makeCompressTool } from "./compress-tool.js"
import { makeDecompressTool } from "./decompress-tool.js"
import { makeSearchTool } from "./search-tool.js"
import { makeStatusTool } from "./status-tool.js"
import { SYSTEM_PROMPT } from "./system-prompt.js"

const SYSTEM_MARKER = "BILI CONTEXT MANAGEMENT"

interface ModelRef {
  id?: string
  providerID?: string
}

/** OpenCode V2 context-hook event. Mutable: system + messages + tools, fired
 *  immediately before model dispatch. This shape was verified empirically on
 *  opencode2 v0.0.0-next-17276 (see the probe harness under .test-clean/). */
interface ContextEvent {
  sessionID: string
  agent?: string
  model?: ModelRef
  system: Array<{ type: string; text?: string; [key: string]: unknown }>
  messages: V2Message[]
  tools: Record<string, unknown>
}

interface CatalogModelInfo {
  id: string
  providerID: string
  limit?: { context?: number }
}

/** Structural subset of the V2 plugin setup context (Plugin.define). Deliberately
 *  NOT imported from @opencode-ai/plugin so the built artifact has zero runtime
 *  dependencies and cannot hit V1/V2 package-resolution conflicts. */
interface PluginSetupContext {
  options: Readonly<Record<string, unknown>>
  tool: {
    transform(cb: (tools: { add(tool: unknown): void }) => void): Promise<{ dispose(): Promise<void> }>
  }
  session: {
    hook(name: "context", cb: (event: ContextEvent) => Promise<void> | void): Promise<{ dispose(): Promise<void> }>
  }
  catalog: {
    model: {
      list(): Promise<{ data: CatalogModelInfo[] }>
    }
  }
}

export default {
  id: "billion-context-opencode-v2",
  setup: async (ctx: PluginSetupContext) => {
    const options = (ctx.options ?? {}) as Record<string, unknown>
    const adapter: AdapterConfig = {
      modelContextLimit: numOpt(options.modelContextLimit),
      protectedTools: strArrayOpt(options.protectedTools),
      preserveRecentMessages: numOpt(options.preserveRecentMessages),
      debug: boolOpt(options.debug),
      coreOverrides: options.coreOverrides as AdapterConfig["coreOverrides"],
    }
    if (adapter.debug) process.env.BILI_ACP_DEBUG = "1"

    const runtime = new AcpRuntime(adapter)
    // Per-session model context limit, resolved from the catalog on first use.
    const modelLimits = new Map<string, number | undefined>()

    const resolveModelLimit = async (model: ModelRef | undefined): Promise<number | undefined> => {
      if (!model || typeof model.id !== "string" || typeof model.providerID !== "string") return undefined
      const key = `${model.providerID}/${model.id}`
      if (modelLimits.has(key)) return modelLimits.get(key)
      let limit: number | undefined
      try {
        const out = await ctx.catalog.model.list()
        const found = out.data.find((m) => m.id === model.id && m.providerID === model.providerID)
        limit = typeof found?.limit?.context === "number" ? found.limit.context : undefined
      } catch (err) {
        warn("catalog.model.list failed:", err instanceof Error ? err.message : String(err))
      }
      modelLimits.set(key, limit)
      return limit
    }

    await ctx.tool.transform((tools) => {
      const opts = { codemode: false, permission: "allow" }
      tools.add({ ...makeCompressTool(runtime), options: opts })
      tools.add({ ...makeDecompressTool(runtime), options: opts })
      tools.add({ ...makeSearchTool(runtime), options: opts })
      tools.add({ ...makeStatusTool(runtime), options: opts })
    })

    await ctx.session.hook("context", async (event: ContextEvent) => {
      const sessionID = event.sessionID
      const msgs = Array.isArray(event.messages) ? event.messages : []
      if (!sessionID || msgs.length === 0) return
      try {
        const limit = await resolveModelLimit(event.model)
        if (limit && limit > 0) runtime.setModelLimit(sessionID, limit)
        await runtime.acquireLock(sessionID, () => runPipeline(msgs, sessionID, runtime, event))
      } catch (err) {
        warn("context hook failed:", err instanceof Error ? err.message : String(err))
      }
    })

    return () => {
      runtime.dropAll()
    }
  },
}

async function runPipeline(
  msgs: V2Message[],
  sessionID: string,
  runtime: AcpRuntime,
  event: ContextEvent,
): Promise<void> {
  const conversion = v2ToCoreMessages(msgs)
  const { cores } = conversion
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

  const reassembled = reassemble(turn.messages, msgs, conversion, sessionID)

  if (turn.nudge && turn.nudge.shouldInject) {
    const rendered = renderNudgeText(turn.nudge)
    const text = [rendered.voice ? `[${rendered.voice}]` : "", rendered.text].filter(Boolean).join("\n")
    reassembled.push(makeNudgeMessage(`bili_nudge_${turn.nudge.tier ?? 0}_${Date.now()}`, sessionID, text))
    debug("nudge-injected", { sid: sessionID, tier: turn.nudge.tier, reason: turn.nudge.reason })
  }

  // The host passes this exact array to the provider; rebuild it in place.
  msgs.splice(0, msgs.length, ...reassembled)

  // System prompt: upsert by marker. The host rebuilds `event.system` each
  // dispatch, so replace (not append) to stay idempotent.
  const system = event.system
  if (Array.isArray(system)) {
    const idx = system.findIndex((p) => p.type === "text" && p.text && p.text.includes(SYSTEM_MARKER))
    const part = { type: "text", text: SYSTEM_PROMPT }
    if (idx >= 0) system[idx] = part
    else system.push(part)
  }

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
