import type { CoreMessage } from "acp-kernel"
import { debug, warn } from "@bili/core"

// Leading <acp ...>mNNNNN</acp> tag. XML only — the legacy [mNNNNN] form
// never existed here and matching it would strip user text like "[m12345] ...".
const REF_TAG = new RegExp("^(?:\\x3cacp\\s[^>]*\\x3em\\d{5}\\x3c/acp\\x3e)\\s?\\n?")

export interface OctoPart {
  id: string
  type: string
  text?: string
  ignored?: boolean
  synthetic?: boolean
  tool?: string
  callID?: string
  state?: {
    status: "pending" | "running" | "completed" | "error"
    input?: unknown
    output?: unknown
    error?: string
    metadata?: {
      interrupted?: boolean
      output?: unknown
      [key: string]: unknown
    }
    title?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface OctoTokenUsage {
  total?: number
  input?: number
  output?: number
  reasoning?: number
  cache?: {
    read?: number
    write?: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface OctoModelRef {
  providerID: string
  modelID: string
  variant?: string
}

export interface OctoMessageInfo {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: { created: number; completed?: number }
  agent?: string
  model?: Partial<OctoModelRef>
  providerID?: string
  modelID?: string
  tokens?: OctoTokenUsage
  summary?: boolean
  error?: unknown
  [key: string]: unknown
}

export interface OctoMessage {
  info: OctoMessageInfo
  parts: OctoPart[]
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export interface ConversionResult {
  cores: CoreMessage[]
  partIdToCoreIds: Map<string, string[]>
}

export function octoToCoreMessages(msgs: OctoMessage[]): ConversionResult {
  const cores: CoreMessage[] = []
  const partIdToCoreIds = new Map<string, string[]>()

  for (const msg of msgs) {
    const role: "user" | "assistant" = msg.info.role === "assistant" ? "assistant" : "user"
    let partIdx = -1
    for (const part of msg.parts) {
      partIdx++
      if (part.type === "text") {
        if (part.ignored) continue
        const text = part.text ?? ""
        const id = `${msg.info.id}#t${partIdx}`
        cores.push({ id, role, contentType: "text", text })
        partIdToCoreIds.set(part.id, [id])
      } else if (part.type === "reasoning") {
        const id = `${msg.info.id}#r${partIdx}`
        cores.push({ id, role: "assistant", contentType: "reasoning", text: part.text ?? "" })
        partIdToCoreIds.set(part.id, [id])
      } else if (part.type === "tool" && part.callID && part.tool) {
        const callId = `${msg.info.id}#c${partIdx}`
        const toolCallId = part.callID
        const toolName = part.tool
        cores.push({
          id: callId,
          role: "assistant",
          contentType: "tool-call",
          toolName,
          toolCallId,
          text: safeStringify(part.state?.input),
        })
        const ids = [callId]
        if (part.state?.status === "completed" || part.state?.status === "error") {
          const resultId = `${msg.info.id}#x${partIdx}`
          const outText =
            part.state.status === "completed"
              ? typeof part.state.output === "string"
                ? part.state.output
                : safeStringify(part.state.output)
              : `Error: ${part.state.error ?? ""}`
          cores.push({
            id: resultId,
            role: "tool",
            contentType: "tool-result",
            toolName,
            toolCallId,
            text: outText,
          })
          ids.push(resultId)
        }
        partIdToCoreIds.set(part.id, ids)
      }
    }
  }

  return { cores, partIdToCoreIds }
}

function findTemplateInfo(msgs: OctoMessage[]): OctoMessageInfo | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]!.info.role === "user") return msgs[i]!.info
  }
  return msgs[0]?.info
}

function syntheticUserMessage(
  id: string,
  sessionID: string,
  text: string,
  template: OctoMessageInfo | undefined,
): OctoMessage {
  const base = template ?? {
    id,
    sessionID,
    role: "user" as const,
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "opencode", modelID: "unknown" },
  }
  return {
    info: { ...base, id, sessionID, role: "user", time: { created: Date.now() } },
    parts: [{ id: `${id}_p`, sessionID, messageID: id, type: "text", text }],
  }
}

function trimEnd(s: string): string {
  return s.replace(/\s+$/, "")
}

export function peelRefTagText(text: string): string {
  return text.replace(REF_TAG, "")
}

export function rebuildBodyFromCore(part: OctoPart, coreBody: string, tag: string): OctoPart {
  const body = coreBody.replace(/\s+$/, "")
  return { ...part, text: body.length > 0 ? `${body}\n\n${tag}` : tag }
}

export function patchRefTag(part: OctoPart, core: CoreMessage, role: string): OctoPart {
  const match = core.text ? core.text.match(REF_TAG) : null
  const tag = match ? match[0] : null
  if (!tag) return part
  const tagCore = tag.replace(/\s+$/, "")
  let bodyStart = tagCore.length
  if (core.text!.charAt(bodyStart) === "\n") bodyStart += 1
  const coreBody = core.text!.slice(bodyStart)
  const originalBody = peelRefTagText(part.text ?? "")
  const bodyChanged = trimEnd(coreBody) !== trimEnd(originalBody)
  // Assistant messages remain untagged to avoid giving the model tag-shaped
  // examples to echo. A kernel body rewrite is still authoritative, including
  // a rewrite to an empty body; only the rendered tag is omitted.
  if (role === "assistant") {
    if (bodyChanged) return { ...part, text: coreBody }
    return originalBody === part.text ? part : { ...part, text: originalBody }
  }
  // Honor kernel body mutations and future rewrites for user text, including
  // an empty replacement, so the adapter never restores stale host content.
  if (bodyChanged) {
    return rebuildBodyFromCore(part, coreBody, tag)
  }
  const baseText = originalBody.replace(/\n*$/, "")
  return { ...part, text: baseText.length > 0 ? `${baseText}\n\n${tag}` : tag }
}

export function reassemble(
  outputCores: CoreMessage[],
  inputMsgs: OctoMessage[],
  partIdToCoreIds: Map<string, string[]>,
  sessionID: string,
): OctoMessage[] {
  const outCoreById = new Map(outputCores.map((c) => [c.id, c]))
  const originalByCoreId = new Map<string, number>()
  for (let mi = 0; mi < inputMsgs.length; mi++) {
    for (const part of inputMsgs[mi]!.parts) {
      const ids = partIdToCoreIds.get(part.id)
      if (ids) for (const id of ids) originalByCoreId.set(id, mi)
    }
  }

  const template = findTemplateInfo(inputMsgs)
  const result: OctoMessage[] = []
  const emitted = new Set<number>()

  for (const core of outputCores) {
    const mi = originalByCoreId.get(core.id)
    if (mi === undefined) {
      result.push(syntheticUserMessage(core.id, sessionID, core.text ?? "", template))
      continue
    }
    if (emitted.has(mi)) continue
    emitted.add(mi)
    const orig = inputMsgs[mi]!
    const parts: OctoPart[] = []
    for (const p of orig.parts) {
      const ids = partIdToCoreIds.get(p.id)
      if (!ids) {
        parts.push(p)
        continue
      }
      if (p.type === "tool" && ids.length >= 2) {
        // tool part → [callId, resultId] (result only present for completed/error).
        // Keep the part ONLY if call AND result both survived, so opencode never
        // sees a tool-call without its matching result (or vice versa) — that
        // would produce malformed history that confuses model providers.
        const callAlive = outCoreById.has(ids[0]!)
        const resultAlive = outCoreById.has(ids[1]!)
        if (!(callAlive && resultAlive)) continue
        parts.push(p)
        continue
      }
      const survived = ids.some((id) => outCoreById.has(id))
      if (!survived) continue
      if (p.type === "text") {
        const tagged = outCoreById.get(ids[0]!)
        if (tagged?.text) {
          parts.push(patchRefTag(p, tagged, orig.info.role))
        } else {
          parts.push(p)
        }
      } else {
        parts.push(p)
      }
    }
    if (parts.length) result.push({ info: orig.info, parts })
  }

  return result
}

export function makeNudgeMessage(
  id: string,
  sessionID: string,
  text: string,
  inputMsgs: OctoMessage[],
): OctoMessage {
  return syntheticUserMessage(id, sessionID, text, findTemplateInfo(inputMsgs))
}

export function deriveSessionId(msgs: OctoMessage[]): string | undefined {
  // Scan for the first message with a non-empty sessionID rather than blindly
  // trusting msgs[0] — opencode may prepend synthetic/system messages whose
  // sessionID differs or is empty, which would otherwise silently skip the
  // whole pipeline (index.ts early-returns on a falsy sessionID).
  let first: string | undefined
  let seenDifferent = false
  for (const m of msgs) {
    const sid = m?.info?.sessionID
    if (!sid) continue
    if (first === undefined) first = sid
    else if (sid !== first) seenDifferent = true
  }
  // opencode normally sends a single session's messages per transform call.
  // If we ever see mixed sessionIDs (e.g. a future subagent/fork flow), surface
  // it so a silent cross-session state merge doesn't go undiagnosed — we still
  // proceed on the first session, which is the safe default. Escalated to warn
  // (not debug) because the consequence is wrong-state-writes: production runs
  // would otherwise silently fold a second session's messages into the first.
  if (first && seenDifferent) {
    warn("deriveSessionId: mixed sessionIDs in one transform batch; proceeding on first", { first })
  }
  return first
}
