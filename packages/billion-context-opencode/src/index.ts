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
  reassemble as reassembleV1,
  makeNudgeMessage as makeNudgeMessageV1,
  deriveSessionId,
  type OctoMessage,
} from "./messages-v1.js"
import { selectV1TokenCount } from "./usage-v1.js"
import {
  v2ToCoreMessages,
  reassemble as reassembleV2,
  makeNudgeMessage as makeNudgeMessageV2,
  type V2Message,
} from "./messages-v2.js"
import {
  makeV2CompressTool,
  makeV2DecompressTool,
  makeV2SearchTool,
  makeV2StatusTool,
} from "./v2-tools.js"

// ---------------------------------------------------------------------------
// Shared adapter-config builder. Both the V1 entry (input, options) and the V2
// setup (ctx.options) feed the same AdapterConfig shape.
// ---------------------------------------------------------------------------

function buildAdapter(options: Record<string, unknown>): AdapterConfig {
  return {
    modelContextLimit: numOpt(options.modelContextLimit),
    protectedTools: strArrayOpt(options.protectedTools),
    preserveRecentMessages: numOpt(options.preserveRecentMessages),
    debug: boolOpt(options.debug),
    coreOverrides: options.coreOverrides as AdapterConfig["coreOverrides"],
  }
}

// ===========================================================================
// V1 — opencode V1 plugin (experimental.chat.* hooks).
// opencode V1 calls the default export as a function. This is that function.
// ===========================================================================

const V1_TAG_ETIQUETTE = `TAG ETIQUETTE
- NEVER echo, repeat, or reference the acp XML tags in your responses. They are address labels for the compression tools, not content — anything you write is stored verbatim.
- Assistant messages are untagged — infer their refs from adjacent tagged messages (refs are assigned sequentially).`

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

async function runPipelineV1(
  msgs: OctoMessage[],
  sessionID: string,
  runtime: AcpRuntime,
  output: TransformOutput,
): Promise<void> {
  const { cores, partIdToCoreIds } = octoToCoreMessages(msgs)
  const state: CompressionState = await runtime.stateFor(sessionID)

  const coveredIds = collectCoveredMessageIds(state)
  const resolved = runtime.configFor(runtime.getModelLimit(sessionID))
  const estimatedTokens = estimateTokens(cores, coveredIds)
  const usage = selectV1TokenCount(msgs, state, estimatedTokens)
  const { tokenCount } = usage
  debug("transform-in", {
    sid: sessionID,
    msgs: msgs.length,
    cores: cores.length,
    estimatedTokens,
    reportedTokens: usage.reported?.total,
    tokenCount,
    tokenSource: usage.source,
    usageFallbackReason: usage.fallbackReason,
    limit: resolved.modelContextLimit,
    blocks: state.blocks.length,
  })

  const turn = runtime.core.processTurn({
    messages: cores,
    state,
    config: resolved.kernel,
    tokenCount,
    renderTags: "text-only",
  })

  runtime.setCores(sessionID, cores)
  runtime.cacheTurn(sessionID, turn.state, cores, tokenCount, turn, resolved)
  await runtime.save(turn.state, sessionID)

  const reassembled = reassembleV1(turn.messages, msgs, partIdToCoreIds, sessionID)

  if (turn.nudge && turn.nudge.shouldInject) {
    const rendered = renderNudgeText(turn.nudge)
    const text = [rendered.voice ? `[${rendered.voice}]` : "", rendered.text].filter(Boolean).join("\n")
    reassembled.push(makeNudgeMessageV1(`bili_nudge_${turn.nudge.tier ?? 0}_${Date.now()}`, sessionID, text, msgs))
    debug("nudge-injected", { sid: sessionID, tier: turn.nudge.tier, reason: turn.nudge.reason })
  }

  // opencode V1 calls messages.transform with a bare wrapper `{ messages: msgs }`
  // and ignores the returned value, so rebuild the same array in place.
  msgs.splice(0, msgs.length, ...reassembled)
  output.messages = reassembled
  debug("transform-out", { sid: sessionID, outMsgs: reassembled.length, nudge: !!turn.nudge?.shouldInject })
}

async function biliAcpPluginV1(
  _input: PluginInput,
  options: Record<string, unknown> = {},
): Promise<OctoHooks> {
  const adapter = buildAdapter(options)
  if (adapter.debug) process.env.BILI_ACP_DEBUG = "1"

  const runtime = new AcpRuntime(adapter)

  return {
    tool: {
      bili_compress: makeCompressTool(runtime),
      bili_decompress: makeDecompressTool(runtime),
      bili_search: makeSearchTool(runtime),
      bili_status: makeStatusTool(runtime),
    },

    "experimental.chat.system.transform": async (input, output) => {
      const ctx = input.model?.limit?.context
      if (ctx && ctx > 0 && input.sessionID) {
        // Per-session authoritative value; see config.ts FALLBACK_LIMIT for the
        // first-turn behavior before this hook records the limit.
        runtime.setModelLimit(input.sessionID, ctx)
      }
      output.system.push(`${SYSTEM_PROMPT}\n\n${V1_TAG_ETIQUETTE}`)
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      const msgs = output.messages
      const sessionID = deriveSessionId(msgs)
      if (!sessionID || msgs.length === 0) return
      try {
        await runtime.acquireLock(sessionID, () => runPipelineV1(msgs, sessionID, runtime, output))
      } catch (err) {
        warn("messages.transform failed:", err instanceof Error ? err.message : String(err))
      }
    },
  }
}

// ===========================================================================
// V2 — opencode V2 plugin ({ id, setup(ctx) } shape).
// opencode V2 reads the default export's `.id` and calls `.setup(ctx)`.
//
// `Plugin.define` in the V2 SDK (@opencode-ai/plugin) is an identity function
// (`function define(plugin){ return plugin }`) — no branding, no Symbol, no
// runtime validation — so V2 accepts any object with { id, setup }. Since JS
// functions are objects, a single export that is callable (V1) AND carries
// { id, setup } (V2) satisfies BOTH loaders. See the dual-shape export below.
// ===========================================================================

/** Must match the first line of `@bili/core`'s SYSTEM_PROMPT so the V2 context
 *  hook's upsert (replace vs. append) actually finds the existing prompt and
 *  does not append a duplicate on every dispatch. Exported for a regression
 *  test that guards this invariant against SYSTEM_PROMPT edits. */
export const SYSTEM_MARKER = "ACP TOOLS (billion-context)"

interface ModelRef {
  id?: string
  providerID?: string
}

/** OpenCode V2 context-hook event. Mutable: system + messages + tools, fired
 *  immediately before model dispatch. */
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

async function runPipelineV2(
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
  runtime.cacheTurn(sessionID, turn.state, cores, tokenCount, turn, resolved)
  await runtime.save(turn.state, sessionID)

  const reassembled = reassembleV2(turn.messages, msgs, conversion, sessionID)

  if (turn.nudge && turn.nudge.shouldInject) {
    const rendered = renderNudgeText(turn.nudge)
    const text = [rendered.voice ? `[${rendered.voice}]` : "", rendered.text].filter(Boolean).join("\n")
    reassembled.push(makeNudgeMessageV2(`bili_nudge_${turn.nudge.tier ?? 0}_${Date.now()}`, sessionID, text))
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

async function setupV2(ctx: PluginSetupContext): Promise<() => void> {
  const options = (ctx.options ?? {}) as Record<string, unknown>
  const adapter = buildAdapter(options)
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
    tools.add({ ...makeV2CompressTool(runtime), options: opts })
    tools.add({ ...makeV2DecompressTool(runtime), options: opts })
    tools.add({ ...makeV2SearchTool(runtime), options: opts })
    tools.add({ ...makeV2StatusTool(runtime), options: opts })
  })

  await ctx.session.hook("context", async (event) => {
    const sessionID = event.sessionID
    const msgs = Array.isArray(event.messages) ? event.messages : []
    if (!sessionID || msgs.length === 0) return
    try {
      const limit = await resolveModelLimit(event.model)
      if (limit && limit > 0) runtime.setModelLimit(sessionID, limit)
      await runtime.acquireLock(sessionID, () => runPipelineV2(msgs, sessionID, runtime, event))
    } catch (err) {
      warn("context hook failed:", err instanceof Error ? err.message : String(err))
    }
  })

  return () => {
    runtime.dropAll()
  }
}

// ---------------------------------------------------------------------------
// Dual-shape default export.
//
// `Object.assign(fn, { id, setup })` returns `fn & { id, setup }` — the SAME
// function object (still callable for V1) now carrying `.id` and `.setup`
// (read by V2). One package, one entry, loads on both opencode major versions:
//   - opencode V1: sees a function, calls it as the V1 plugin factory.
//   - opencode V2: reads `.id` + calls `.setup(ctx)` (Plugin.define is identity).
// ---------------------------------------------------------------------------

export default Object.assign(biliAcpPluginV1, {
  id: "billion-context-opencode",
  setup: setupV2,
})
