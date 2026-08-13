import type { CompressionState } from "acp-kernel"
import type { OctoMessage, OctoMessageInfo, OctoModelRef, OctoTokenUsage } from "./messages-v1.js"

export interface ReportedUsage {
  assistantId: string
  created: number
  providerID?: string
  modelID?: string
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface ReportedUsageSelection {
  usage?: ReportedUsage
  reason:
    | "no-assistant"
    | "invalid-assistant-time"
    | "summary-assistant"
    | "error-assistant"
    | "model-mismatch"
    | "missing-usage"
    | "invalid-usage"
    | "zero-usage"
    | "valid"
}

export interface V1TokenSelection {
  tokenCount: number
  source: "reported" | "estimated"
  reported?: ReportedUsage
  fallbackReason?: ReportedUsageSelection["reason"] | "pre-compression-snapshot"
}

function isNewerAssistant(candidate: OctoMessageInfo, current: OctoMessageInfo): boolean {
  const candidateTimeValid = Number.isFinite(candidate.time?.created)
  const currentTimeValid = Number.isFinite(current.time?.created)
  // An invalid timestamp cannot be chronologically ordered. Treat an invalid
  // candidate as the newest so extractLatestReportedUsage rejects it instead
  // of silently reusing an older assistant's stale snapshot.
  if (candidateTimeValid !== currentTimeValid) return !candidateTimeValid
  if (!candidateTimeValid && !currentTimeValid) return candidate.id > current.id
  if (candidate.time.created !== current.time.created) return candidate.time.created > current.time.created
  return candidate.id > current.id
}

function latestAssistant(msgs: OctoMessage[]): OctoMessageInfo | undefined {
  let latest: OctoMessageInfo | undefined
  for (const msg of msgs) {
    if (msg.info.role !== "assistant") continue
    if (!latest || isNewerAssistant(msg.info, latest)) latest = msg.info
  }
  return latest
}

function latestUser(msgs: OctoMessage[]): OctoMessageInfo | undefined {
  let latest: OctoMessageInfo | undefined
  for (const msg of msgs) {
    if (msg.info.role !== "user") continue
    if (!latest || isNewerAssistant(msg.info, latest)) latest = msg.info
  }
  return latest
}

export function currentUserModel(msgs: OctoMessage[]): OctoModelRef | undefined {
  const model = latestUser(msgs)?.model
  if (!model || typeof model.providerID !== "string" || typeof model.modelID !== "string") return undefined
  if (!model.providerID || !model.modelID) return undefined
  return { providerID: model.providerID, modelID: model.modelID }
}

function assistantModel(info: OctoMessageInfo): OctoModelRef | undefined {
  const providerID = typeof info.providerID === "string" ? info.providerID : info.model?.providerID
  const modelID = typeof info.modelID === "string" ? info.modelID : info.model?.modelID
  if (typeof providerID !== "string" || typeof modelID !== "string") return undefined
  return { providerID, modelID }
}

function numberField(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function usageTotal(tokens: OctoTokenUsage | undefined):
  | { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total: number }
  | undefined {
  if (!tokens || !numberField(tokens.input) || !numberField(tokens.output) || !numberField(tokens.reasoning)) return undefined
  if (!tokens.cache || !numberField(tokens.cache.read) || !numberField(tokens.cache.write)) return undefined
  const { input, output, reasoning } = tokens
  const cacheRead = tokens.cache.read
  const cacheWrite = tokens.cache.write
  const total = input + output + reasoning + cacheRead + cacheWrite
  if (!Number.isFinite(total)) return undefined
  return { input, output, reasoning, cacheRead, cacheWrite, total }
}

/**
 * Select and validate the latest provider snapshot. The latest assistant is
 * selected independently of array order because OpenCode can reorder messages
 * after compaction. Once selected, it is the only candidate: an invalid latest
 * snapshot never falls back to an older assistant's stale usage.
 */
export function extractLatestReportedUsage(msgs: OctoMessage[], expectedModel = currentUserModel(msgs)): ReportedUsageSelection {
  const assistant = latestAssistant(msgs)
  if (!assistant) return { reason: "no-assistant" }
  const created = assistant.time?.created
  if (!Number.isFinite(created)) return { reason: "invalid-assistant-time" }
  if (assistant.summary === true) return { reason: "summary-assistant" }
  if (assistant.error !== undefined && assistant.error !== null) return { reason: "error-assistant" }

  const model = assistantModel(assistant)
  if (expectedModel && (!model || model.providerID !== expectedModel.providerID || model.modelID !== expectedModel.modelID)) {
    return { reason: "model-mismatch" }
  }

  if (!assistant.tokens) return { reason: "missing-usage" }
  const values = usageTotal(assistant.tokens)
  if (!values) {
    const hasAllFields =
      assistant.tokens.input !== undefined &&
      assistant.tokens.output !== undefined &&
      assistant.tokens.reasoning !== undefined &&
      assistant.tokens.cache?.read !== undefined &&
      assistant.tokens.cache?.write !== undefined
    return { reason: hasAllFields ? "invalid-usage" : "missing-usage" }
  }
  if (values.total <= 0) return { reason: "zero-usage" }

  return {
    reason: "valid",
    usage: {
      assistantId: assistant.id,
      created,
      providerID: model?.providerID,
      modelID: model?.modelID,
      ...values,
    },
  }
}

/** A provider snapshot is stale when any compression block was created at or
 * after the assistant request that produced it. A newer assistant naturally
 * clears this condition without a second usage cache or persistent marker. */
export function usageInvalidatedByCompression(usage: ReportedUsage, state: CompressionState): boolean {
  return state.blocks.some((block) => Number.isFinite(block.createdAt) && block.createdAt >= usage.created)
}

export function selectV1TokenCount(msgs: OctoMessage[], state: CompressionState, estimatedTokens: number): V1TokenSelection {
  const selection = extractLatestReportedUsage(msgs)
  if (selection.usage && !usageInvalidatedByCompression(selection.usage, state)) {
    return { tokenCount: selection.usage.total, source: "reported", reported: selection.usage }
  }
  if (selection.usage) return { tokenCount: estimatedTokens, source: "estimated", reported: selection.usage, fallbackReason: "pre-compression-snapshot" }
  return { tokenCount: estimatedTokens, source: "estimated", fallbackReason: selection.reason }
}
