import { test } from "node:test"
import assert from "node:assert/strict"
import { octoToCoreMessages, reassemble, makeNudgeMessage, type OctoMessage } from "../src/messages-v1.js"
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

test("reassemble: kernel-truncated V1 tool body replaces completed output", () => {
  const msgs = [toolMsg("a2", "s1", "bash", "call_1", "ORIGINAL_LONG_OUTPUT")]
  const originalPart = msgs[0]!.parts[0]!
  const { cores, partIdToCoreIds } = octoToCoreMessages(msgs)
  const truncated = cores.map((c) => (c.id === "a2#x0" ? { ...c, text: "TRUNCATED_BODY" } : c))
  const out = reassemble(truncated, msgs, partIdToCoreIds, "s1")
  const part = out[0]!.parts[0]!
  assert.notEqual(part, originalPart, "changed body produces a copied part")
  assert.equal(part.state!.status, "completed", "completed status preserved")
  assert.equal(part.state!.output, "TRUNCATED_BODY", "truncated body applied to completed output")
  assert.deepEqual(part.state!.input, { a: 1 }, "input preserved")
})

test("reassemble: trailing whitespace difference is not treated as a V1 tool rewrite", () => {
  const msgs = [toolMsg("a2", "s1", "bash", "call_1", "done")]
  const originalPart = msgs[0]!.parts[0]!
  const { cores, partIdToCoreIds } = octoToCoreMessages(msgs)
  const padded = cores.map((c) => (c.id === "a2#x0" ? { ...c, text: "done\n\n  " } : c))
  const out = reassemble(padded, msgs, partIdToCoreIds, "s1")
  assert.equal(out[0]!.parts[0], originalPart, "unchanged body keeps the original part reference")
  assert.equal(out[0]!.parts[0]!.state!.output, "done", "original output kept")
})

test("reassemble: kernel-truncated V1 tool error preserves error state", () => {
  const msg = toolMsg("a2", "s1", "bash", "call_1", "unused")
  msg.parts[0]!.state = { status: "error", input: { a: 1 }, error: "ORIGINAL_LONG_ERROR", title: "bash" }
  const { cores, partIdToCoreIds } = octoToCoreMessages([msg])
  assert.equal(cores.find((c) => c.id === "a2#x0")!.text, "Error: ORIGINAL_LONG_ERROR", "error projected for kernel")
  const truncated = cores.map((c) => (c.id === "a2#x0" ? { ...c, text: "Error: TRUNCATED_ERROR" } : c))
  const out = reassemble(truncated, [msg], partIdToCoreIds, "s1")
  const state = out[0]!.parts[0]!.state!
  assert.equal(state.status, "error", "error status preserved")
  assert.equal(state.error, "TRUNCATED_ERROR", "adapter prefix removed before writing error")
  assert.equal(state.output, undefined, "completed output field not introduced")
  assert.deepEqual(state.input, { a: 1 }, "input preserved")
  assert.equal(state.title, "bash", "title preserved")
})

test("reassemble: interrupted V1 tool output is projected and rewritten in metadata", () => {
  const msg = toolMsg("a2", "s1", "bash", "call_1", "unused")
  msg.parts[0]!.state = {
    status: "error",
    input: { a: 1 },
    error: "Tool execution aborted",
    metadata: { interrupted: true, output: "ORIGINAL_PARTIAL_OUTPUT", exitCode: 130 },
    title: "bash",
  }
  const { cores, partIdToCoreIds } = octoToCoreMessages([msg])
  assert.equal(cores.find((c) => c.id === "a2#x0")!.text, "ORIGINAL_PARTIAL_OUTPUT", "partial output projected for kernel")
  const truncated = cores.map((c) => (c.id === "a2#x0" ? { ...c, text: "TRUNCATED_PARTIAL_OUTPUT" } : c))
  const out = reassemble(truncated, [msg], partIdToCoreIds, "s1")
  const state = out[0]!.parts[0]!.state!
  assert.equal(state.status, "error", "interrupted status preserved")
  assert.equal(state.error, "Tool execution aborted", "original interruption error preserved")
  assert.equal(state.metadata?.interrupted, true, "interrupted marker preserved")
  assert.equal(state.metadata?.output, "TRUNCATED_PARTIAL_OUTPUT", "truncated partial output written where V1 reads it")
  assert.equal(state.metadata?.exitCode, 130, "other metadata preserved")
})

test("reassemble: assistant text parts carry no acp tag", () => {
  const core = createCore()
  const config = defaultConfig(200000)
  const msgs = [userMsg("u1", "s1", "hello"), assistantMsg("a1", "s1", "hi there")]
  const { cores, partIdToCoreIds } = octoToCoreMessages(msgs)
  const turn = core.processTurn({ messages: cores, state: createInitialState(), config, tokenCount: 100, renderTags: "text-only" })
  const out = reassemble(turn.messages, msgs, partIdToCoreIds, "s1")
  const userPart = out.find((m) => m.info.role === "user")!.parts[0]!
  const asstPart = out.find((m) => m.info.role === "assistant")!.parts[0]!
  assert.match(userPart.text as string, /<acp[^>]*>m0/, "user part tagged")
  assert.doesNotMatch(asstPart.text as string, /<acp/, "assistant part untagged")
  assert.equal(asstPart.text, "hi there", "assistant body untouched")
})

test("reassemble: user text part keeps body first, tag appended at the end", () => {
  const core = createCore()
  const config = defaultConfig(200000)
  const msgs = [userMsg("u1", "s1", "hello world")]
  const { cores, partIdToCoreIds } = octoToCoreMessages(msgs)
  const turn = core.processTurn({ messages: cores, state: createInitialState(), config, tokenCount: 100, renderTags: "text-only" })
  const out = reassemble(turn.messages, msgs, partIdToCoreIds, "s1")
  const text = out[0]!.parts[0]!.text as string
  assert.ok(text.startsWith("hello world"), "body stays at the start")
  assert.match(text, /<acp[^>]*>m\d{5}<\/acp>\s*$/, "tag appended at the end")
})

test("reassemble: kernel text rewrites survive while assistant tags stay omitted", () => {
  const msgs = [userMsg("u1", "s1", "old user body"), assistantMsg("a1", "s1", "old assistant body"), userMsg("u2", "s1", "body to clear")]
  const { cores, partIdToCoreIds } = octoToCoreMessages(msgs)
  const rewritten = cores.map((c) => {
    if (c.id === "u1#t0") return { ...c, text: '<acp tokens="8" type="text">m00001</acp>\nnew user body from kernel' }
    if (c.id === "a1#t0") return { ...c, text: '<acp tokens="8" type="text">m00002</acp>\nnew assistant body from kernel' }
    if (c.id === "u2#t0") return { ...c, text: '<acp tokens="0" type="text">m00003</acp>\n' }
    return c
  })
  const out = reassemble(rewritten, msgs, partIdToCoreIds, "s1")
  const userText = out[0]!.parts[0]!.text as string
  assert.ok(userText.startsWith("new user body from kernel"), "user rebuilt from kernel body")
  assert.match(userText, /<acp[^>]*>m00001<\/acp>\s*$/, "user tag appended at the end")
  assert.equal(out[1]!.parts[0]!.text, "new assistant body from kernel", "assistant rewrite retained without tag")
  assert.match(out[2]!.parts[0]!.text as string, /^<acp[^>]*>m00003<\/acp>\s*$/, "empty rewrite does not restore stale body")
})

test("reassemble: legacy [mNNNNN] text is not mistaken for a tag", () => {
  const core = createCore()
  const config = defaultConfig(200000)
  const msgs = [userMsg("u1", "s1", "[m12345] what is this ref format?")]
  const { cores, partIdToCoreIds } = octoToCoreMessages(msgs)
  const turn = core.processTurn({ messages: cores, state: createInitialState(), config, tokenCount: 100, renderTags: "text-only" })
  const out = reassemble(turn.messages, msgs, partIdToCoreIds, "s1")
  const text = out[0]!.parts[0]!.text as string
  assert.ok(text.startsWith("[m12345] what is this ref format?"), "user body with [mNNNNN] prefix kept verbatim")
})

test("makeNudgeMessage produces a valid user message", () => {
  const msgs = [userMsg("u1", "s1", "hi")]
  const n = makeNudgeMessage("bili_nudge_0", "s1", "please compress", msgs)
  assert.equal(n.info.role, "user")
  assert.equal(n.parts[0]!.type, "text")
  assert.equal(n.parts[0]!.text, "please compress")
})
