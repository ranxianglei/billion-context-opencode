import type { CoreMessage } from "acp-kernel"
import { debug, warn } from "./log.js"

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
    title?: string
  }
  [key: string]: unknown
}

export interface OctoMessageInfo {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: { created: number; completed?: number }
  agent?: string
  model?: { providerID: string; modelID: string }
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
        // Honor kernel body mutations (emergency truncation of large
        // tool-results): if the result core's text differs from the original
        // output, replace it — otherwise truncation never reaches the model.
        parts.push(applyToolBody(p, outCoreById.get(ids[1]!)))
        continue
      }
      const survived = ids.some((id) => outCoreById.has(id))
      if (!survived) continue
      if (p.type === "text") {
        const tagged = outCoreById.get(ids[0]!)
        parts.push({ ...p, text: tagged?.text ?? p.text })
      } else {
        parts.push(p)
      }
    }
    if (parts.length) result.push({ info: orig.info, parts })
  }

  return result
}

function trimEnd(s: string): string {
  return s.replace(/\s+$/, "")
}

export function applyToolBody(part: OctoPart, resultCore: CoreMessage | undefined): OctoPart {
  const coreBody = resultCore?.text ?? ""
  if (!coreBody) return part
  // Compare the original output against the result core's text — kernel
  // truncation rewrites that text, and dropping the rewrite would leave the
  // full output in the request.
  const state = part.state
  const originalText =
    state?.status === "completed"
      ? typeof state.output === "string"
        ? state.output
        : safeStringify(state.output)
      : `Error: ${state?.error ?? ""}`
  if (trimEnd(coreBody) === trimEnd(originalText)) return part
  return { ...part, state: { status: "completed", ...state, output: coreBody } }
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
