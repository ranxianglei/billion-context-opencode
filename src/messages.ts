import type { CoreMessage } from "acp-kernel"
import { debug } from "./log.js"

export interface V2Part {
  type: string
  id?: string
  name?: string
  text?: string
  input?: unknown
  result?: { type?: string; value?: unknown }
  [key: string]: unknown
}

export interface V2Message {
  id?: string
  role: string
  content?: V2Part[]
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

/** Stable per-message identity for a V2 message. `role:"tool"` messages carry
 *  no id in the context hook (observed on opencode2 next-17276), so fall back
 *  to a positional marker — but only for messages whose parts all carry their
 *  own tool call ids. */
function messageBaseId(m: V2Message, index: number): string {
  if (typeof m.id === "string" && m.id) return m.id
  return `__msg${index}`
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function resultValueToText(result: V2Part["result"] | undefined): string {
  if (!result || typeof result !== "object") return ""
  const value = (result as { value?: unknown }).value
  switch (result.type) {
    case "error":
      return `Error: ${safeStringify(value)}`
    case "json":
      return safeStringify(value)
    case "content":
      if (Array.isArray(value)) {
        return value
          .map((c) => {
            if (c && typeof c === "object" && (c as { type?: string }).type === "file") {
              const f = c as { uri?: string; mime?: string }
              return `[file ${f.uri ?? ""} (${f.mime ?? ""})]`
            }
            const t = c as { text?: string }
            return typeof t.text === "string" ? t.text : ""
          })
          .join("\n")
      }
      return safeStringify(value)
    default:
      return safeStringify(value)
  }
}

export interface OriginRef {
  mi: number
  pi: number
}

export interface ConversionResult {
  cores: CoreMessage[]
  origin: Map<string, OriginRef>
  partToCoreIds: Map<string, string[]>
}

export function v2ToCoreMessages(msgs: V2Message[]): ConversionResult {
  const cores: CoreMessage[] = []
  const origin = new Map<string, OriginRef>()
  const partToCoreIds = new Map<string, string[]>()

  msgs.forEach((msg, mi) => {
    const base = messageBaseId(msg, mi)
    const parts = Array.isArray(msg.content) ? msg.content : []
    parts.forEach((part, pi) => {
      const key = `${mi}:${pi}`
      if (part.type === "text") {
        const id = `${base}#t${pi}`
        cores.push({ id, role: msg.role === "assistant" ? "assistant" : "user", contentType: "text", text: part.text ?? "" })
        origin.set(id, { mi, pi })
        partToCoreIds.set(key, [id])
      } else if (part.type === "reasoning") {
        const id = `${base}#r${pi}`
        cores.push({ id, role: "assistant", contentType: "reasoning", text: part.text ?? "" })
        origin.set(id, { mi, pi })
        partToCoreIds.set(key, [id])
      } else if (part.type === "tool-call" && typeof part.id === "string") {
        const callId = `${part.id}#call`
        const resultId = `${part.id}#result`
        cores.push({
          id: callId,
          role: "assistant",
          contentType: "tool-call",
          toolName: part.name,
          toolCallId: part.id,
          text: safeStringify(part.input),
        })
        origin.set(callId, { mi, pi })
        // Tool parts become [call, result] when the call has a matching result
        // elsewhere in the batch (a role:"tool" message). Both must survive for
        // the part to be kept — see reassemble().
        partToCoreIds.set(key, [callId, resultId])
      } else if (part.type === "tool-result" && typeof part.id === "string") {
        const id = `${part.id}#result`
        cores.push({
          id,
          role: "tool",
          contentType: "tool-result",
          toolName: part.name,
          toolCallId: part.id,
          text: resultValueToText(part.result),
        })
        origin.set(id, { mi, pi })
        partToCoreIds.set(key, [id])
      }
    })
  })

  return { cores, origin, partToCoreIds }
}

/** Messages with no compressible cores (e.g. media-only attachments) must never
 *  be dropped by the pipeline — there is no core id to cover or restore. */
function hasCompressiblePart(msg: V2Message): boolean {
  const parts = Array.isArray(msg.content) ? msg.content : []
  return parts.some((p) => p.type === "text" || p.type === "reasoning" || p.type === "tool-call" || p.type === "tool-result")
}

function syntheticMessage(core: CoreMessage): V2Message {
  const text = core.text ?? ""
  if (core.id.startsWith("acp_summary_")) {
    return {
      id: `bili_summary_${core.id.replace("acp_summary_", "")}`,
      role: "user",
      content: [{ type: "text", text }],
    }
  }
  return {
    role: "user",
    content: [{ type: "text", text }],
  }
}

function partSurvives(part: V2Part, coreIds: string[] | undefined, outById: Map<string, CoreMessage>): boolean {
  if (!coreIds || coreIds.length === 0) return true
  if (part.type === "tool-call") {
    // Keep a tool-call part only when BOTH the call and its matching result
    // survived — a lone call would confuse model providers downstream.
    return coreIds.every((id) => outById.has(id))
  }
  if (part.type === "tool-result" && typeof part.id === "string") {
    // Mirror rule for results: a dangling tool-result (no surviving call) must
    // not leak into provider history.
    return outById.has(`${part.id}#call`) && outById.has(`${part.id}#result`)
  }
  return coreIds.some((id) => outById.has(id))
}

export function reassemble(
  outputCores: CoreMessage[],
  inputMsgs: V2Message[],
  conversion: ConversionResult,
  sessionID: string,
): V2Message[] {
  const { origin, partToCoreIds } = conversion
  const outById = new Map(outputCores.map((c) => [c.id, c]))

  const result: V2Message[] = []
  const emitted = new Set<number>()
  // Pointer to the next original message not yet considered, so media-only
  // (no-core) messages are emitted in place between surviving messages.
  let cursor = 0

  const emitMessage = (mi: number): void => {
    if (mi < 0 || mi >= inputMsgs.length || emitted.has(mi)) return
    emitted.add(mi)
    const orig = inputMsgs[mi]!
    const parts: V2Part[] = []
    const srcParts = Array.isArray(orig.content) ? orig.content : []
    for (let pi = 0; pi < srcParts.length; pi++) {
      const part = srcParts[pi]!
      const coreIds = partToCoreIds.get(`${mi}:${pi}`)
      if (!coreIds || partSurvives(part, coreIds, outById)) {
        if (part.type === "text" && coreIds && coreIds.length > 0) {
          const tagged = outById.get(coreIds[0]!)
          parts.push(tagged ? { ...part, text: tagged.text ?? part.text } : part)
        } else {
          parts.push(part)
        }
      }
    }
    if (parts.length > 0) result.push({ ...orig, content: parts })
  }

  for (const core of outputCores) {
    const ref = origin.get(core.id)
    if (ref === undefined) {
      result.push(syntheticMessage(core))
      continue
    }
    // Flush any intervening media-only messages that must be preserved.
    while (cursor < ref.mi) {
      if (!emitted.has(cursor) && !hasCompressiblePart(inputMsgs[cursor]!)) emitMessage(cursor)
      cursor++
    }
    if (cursor === ref.mi) cursor++
    emitMessage(ref.mi)
  }

  // Trailing media-only (or otherwise no-core) messages.
  while (cursor < inputMsgs.length) {
    if (!emitted.has(cursor) && !hasCompressiblePart(inputMsgs[cursor]!)) emitMessage(cursor)
    cursor++
  }

  debug("reassemble", { sid: sessionID, inMsgs: inputMsgs.length, outMsgs: result.length, kept: emitted.size })
  return result
}

export function makeNudgeMessage(id: string, sessionID: string, text: string): V2Message {
  return {
    id,
    role: "user",
    content: [{ type: "text", text }],
  }
}
