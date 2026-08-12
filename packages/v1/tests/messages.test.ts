import { test } from "node:test"
import assert from "node:assert/strict"
import { octoToCoreMessages, reassemble, makeNudgeMessage, type OctoMessage } from "../src/messages.js"
import { createCore, createInitialState, defaultConfig } from "acp-kernel"

function userMsg(id: string, sessionID: string, text: string): OctoMessage {
  return {
    info: { id, sessionID, role: "user", time: { created: Date.now() }, agent: "build", model: { providerID: "x", modelID: "y" } },
    parts: [{ id: `${id}_p`, sessionID, messageID: id, type: "text", text }],
  }
}

function assistantMsg(id: string, sessionID: string, text: string): OctoMessage {
  return {
    info: { id, sessionID, role: "assistant", time: { created: Date.now() }, parentID: "p", modelID: "y", providerID: "x", mode: "default", path: { cwd: "/", root: "/" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
    parts: [{ id: `${id}_p`, sessionID, messageID: id, type: "text", text }],
  }
}

function toolMsg(id: string, sessionID: string, tool: string, callID: string, output: string): OctoMessage {
  return {
    info: { id, sessionID, role: "assistant", time: { created: Date.now() }, parentID: "p", modelID: "y", providerID: "x", mode: "default", path: { cwd: "/", root: "/" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
    parts: [{ id: `${id}_p`, sessionID, messageID: id, type: "tool", tool, callID, state: { status: "completed", input: { a: 1 }, output, title: tool } }],
  }
}

test("octoToCoreMessages: text -> core, tool -> call+result pair sharing callID", () => {
  const msgs = [userMsg("u1", "s1", "hello"), assistantMsg("a1", "s1", "hi"), toolMsg("a2", "s1", "bash", "call_1", "done")]
  const { cores, partIdToCoreIds } = octoToCoreMessages(msgs)
  assert.equal(cores.length, 4)
  assert.equal(cores[0]!.contentType, "text")
  assert.equal(cores[2]!.contentType, "tool-call")
  assert.equal(cores[2]!.toolCallId, "call_1")
  assert.equal(cores[3]!.contentType, "tool-result")
  assert.equal(cores[3]!.toolCallId, "call_1")
  assert.equal(partIdToCoreIds.get("a2_p")!.length, 2)
})

test("reassemble drops tool part when only its result survived (call pruned)", () => {
  // Simulate the kernel pruning the tool-call but leaving the tool-result.
  // Reassembly must drop the whole tool part rather than emit a result with no
  // matching call — that would produce malformed history.
  const msgs = [userMsg("u1", "s1", "hello"), toolMsg("a2", "s1", "bash", "call_1", "done")]
  const { cores, partIdToCoreIds } = octoToCoreMessages(msgs)
  // Keep only the user text core + the tool-result core (drop tool-call a2#c0).
  const prunedCores = [cores[0]!, cores[2]!]
  const out = reassemble(prunedCores, msgs, partIdToCoreIds, "s1")
  // u1 survives; the tool message (a2) must be dropped entirely.
  assert.equal(out.length, 1, "tool message dropped when call/result split")
  assert.equal(out[0]!.info.id, "u1", "only the user message survives")
})

test("reassemble keeps tool part when both call and result survived", () => {
  const msgs = [userMsg("u1", "s1", "hello"), toolMsg("a2", "s1", "bash", "call_1", "done")]
  const { cores, partIdToCoreIds } = octoToCoreMessages(msgs)
  const out = reassemble(cores, msgs, partIdToCoreIds, "s1")
  assert.equal(out.length, 2, "both messages kept when call+result intact")
  assert.equal(out[1]!.parts[0]!.type, "tool", "tool part preserved")
})

test("processTurn tags surviving text and reassembly patches it", () => {
  const core = createCore()
  const config = defaultConfig(200000)
  const msgs = [userMsg("u1", "s1", "hello world"), assistantMsg("a1", "s1", "hi there")]
  const { cores, partIdToCoreIds } = octoToCoreMessages(msgs)
  const turn = core.processTurn({ messages: cores, state: createInitialState(), config, tokenCount: 100, renderTags: "text-only" })
  const out = reassemble(turn.messages, msgs, partIdToCoreIds, "s1")
  assert.equal(out.length, 2)
  const textPart = out[0]!.parts[0]!
  assert.ok((textPart.text as string).includes("m0"), "tag contains m-ref")
  assert.match(textPart.text as string, /<acp[^>]*>m0/)
  assert.ok((textPart.text as string).includes("hello world"), "original text preserved alongside tag")
})

test("compress + reassembly replaces covered messages with synthetic user summary", async () => {
  const core = createCore()
  const config = defaultConfig(200000, { preserveRecentMessages: 1, preserveRecentTokens: 0 })
  const u1Text = "u1content-".repeat(600)
  const a1Text = "a1content-".repeat(600)
  const msgs = [userMsg("u1", "s1", u1Text), assistantMsg("a1", "s1", a1Text), userMsg("u2", "s1", "recent")]
  const { cores, partIdToCoreIds } = octoToCoreMessages(msgs)
  const init = createInitialState()
  const turn1 = core.processTurn({ messages: cores, state: init, config, tokenCount: 100, renderTags: "text-only" })
  const u1Ref = turn1.messages.find((m) => m.id === "u1#t0")
  const a1Ref = turn1.messages.find((m) => m.id === "a1#t0")
  assert.ok(u1Ref, "u1 core present in processed output")
  assert.ok(a1Ref, "a1 core present")

  const refs = turn1.state.messageRefs
  const u1Mref = refs.byRaw["u1#t0"]
  const a1Mref = refs.byRaw["a1#t0"]
  assert.ok(u1Mref && a1Mref, "refs assigned")

  const applied = core.applyCompression({
    ranges: [{ startRef: u1Mref!, endRef: a1Mref!, summary: "SUMMARY: the old conversation about repeatable content was compressed into this block for testing the reassembly pipeline.", topic: "test" }],
    messages: cores,
    state: turn1.state,
    config,
  })
  const turn2 = core.processTurn({ messages: cores, state: applied.state, config, tokenCount: 50, renderTags: "text-only" })
  const out = reassemble(turn2.messages, msgs, partIdToCoreIds, "s1")
  const roles = out.map((m) => m.info.role)
  assert.ok(roles.includes("user"), "has at least one user message")
  const summaryMsg = out.find((m) => m.info.id.startsWith("acp_summary_"))
  assert.ok(summaryMsg, "synthetic summary message injected")
  assert.ok((summaryMsg!.parts[0]!.text as string).includes("SUMMARY: the old conversation"))
  const hasA1 = out.some((m) => m.parts.some((p) => (p.text as string | undefined)?.includes("a1content")))
  assert.equal(hasA1, false, "covered assistant content pruned")
  const hasU2 = out.some((m) => m.parts.some((p) => (p.text as string | undefined)?.includes("recent")))
  assert.ok(hasU2, "recent uncompressed message preserved")
})

test("makeNudgeMessage produces a valid user message", () => {
  const msgs = [userMsg("u1", "s1", "hi")]
  const n = makeNudgeMessage("bili_nudge_0", "s1", "please compress", msgs)
  assert.equal(n.info.role, "user")
  assert.equal(n.parts[0]!.type, "text")
  assert.equal(n.parts[0]!.text, "please compress")
})
