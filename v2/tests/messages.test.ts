import { test } from "node:test"
import assert from "node:assert/strict"
import { v2ToCoreMessages, reassemble, makeNudgeMessage, resultValueToText, type V2Message } from "../src/messages.js"
import { createCore, createInitialState, defaultConfig } from "acp-kernel"

function userMsg(id: string, text: string): V2Message {
  return { id, role: "user", content: [{ type: "text", text }] }
}

function assistantMsg(id: string, text: string): V2Message {
  return { id, role: "assistant", content: [{ type: "text", text }] }
}

function assistantToolMsg(id: string, callId: string, name: string, input: unknown): V2Message {
  return {
    id,
    role: "assistant",
    content: [
      { type: "reasoning", text: "thinking" },
      { type: "tool-call", id: callId, name, input },
    ],
  }
}

function toolMsg(callId: string, name: string, value: unknown): V2Message {
  return {
    role: "tool",
    content: [{ type: "tool-result", id: callId, name, result: { type: "text", value } }],
  }
}

function mediaMsg(id: string): V2Message {
  return { id, role: "user", content: [{ type: "media", mediaType: "image/png", data: "aGVsbG8=" }] }
}

test("v2ToCoreMessages: text/reasoning/tool-call/tool-result -> cores; media skipped", () => {
  const msgs = [userMsg("msg_u1", "hello"), assistantToolMsg("msg_a1", "call_1", "bash", { command: "ls" }), toolMsg("call_1", "bash", "done"), mediaMsg("msg_img")]
  const { cores, origin, partToCoreIds } = v2ToCoreMessages(msgs)
  assert.equal(cores.length, 4)
  assert.equal(cores[0]!.contentType, "text")
  assert.equal(cores[0]!.id, "msg_u1#t0")
  assert.equal(cores[1]!.contentType, "reasoning")
  assert.equal(cores[2]!.contentType, "tool-call")
  assert.equal(cores[2]!.toolCallId, "call_1")
  assert.equal(cores[2]!.toolName, "bash")
  assert.equal(cores[3]!.contentType, "tool-result")
  assert.equal(cores[3]!.toolCallId, "call_1")
  assert.ok(origin.has("msg_u1#t0"))
  assert.ok(origin.has("call_1#call"))
  assert.ok(origin.has("call_1#result"))
  // tool-call part maps to [call, result] so both must survive together.
  assert.deepEqual(partToCoreIds.get("1:1"), ["call_1#call", "call_1#result"])
})

test("resultValueToText renders json/error/content shapes", () => {
  assert.equal(resultValueToText({ type: "json", value: { a: 1 } }), '{"a":1}')
  assert.equal(resultValueToText({ type: "error", value: "boom" }), "Error: boom")
  const content = resultValueToText({
    type: "content",
    value: [
      { type: "text", text: "line1" },
      { type: "file", uri: "/x/y.txt", mime: "text/plain" },
    ],
  })
  assert.match(content, /line1/)
  assert.match(content, /\[file \/x\/y\.txt \(text\/plain\)\]/)
  assert.equal(resultValueToText(undefined), "")
})

test("reassemble drops tool message when only its result survived (call pruned)", () => {
  const msgs = [userMsg("msg_u1", "hello"), assistantToolMsg("msg_a1", "call_1", "bash", { a: 1 }), toolMsg("call_1", "bash", "done")]
  const conversion = v2ToCoreMessages(msgs)
  const out = reassemble(conversion.cores, msgs, conversion, "s1")
  assert.equal(out.length, 3, "all messages kept with full cores")
  // Prune the assistant's tool-call core; the tool-result core alone must not
  // resurrect a dangling pair.
  const pruned = conversion.cores.filter((c) => c.contentType !== "tool-call")
  const out2 = reassemble(pruned, msgs, conversion, "s1")
  assert.ok(!out2.some((m) => m.role === "tool"), "orphan tool-result message dropped")
  assert.ok(!out2.some((m) => (m.content || []).some((p) => p.type === "tool-call")), "orphan tool-call part dropped")
  assert.equal(out2[0]!.id, "msg_u1", "user message first")
})

test("reassemble keeps tool call+result when both survived", () => {
  const msgs = [assistantToolMsg("msg_a1", "call_1", "bash", { a: 1 }), toolMsg("call_1", "bash", "done")]
  const conversion = v2ToCoreMessages(msgs)
  const out = reassemble(conversion.cores, msgs, conversion, "s1")
  assert.equal(out.length, 2)
  assert.equal(out[0]!.content![1]!.type, "tool-call")
  assert.equal(out[1]!.content![0]!.type, "tool-result")
})

test("processTurn tags surviving text and reassembly patches it", () => {
  const core = createCore()
  const config = defaultConfig(200000)
  const msgs = [userMsg("msg_u1", "hello world"), assistantMsg("msg_a1", "hi there")]
  const conversion = v2ToCoreMessages(msgs)
  const turn = core.processTurn({ messages: conversion.cores, state: createInitialState(), config, tokenCount: 100, renderTags: "text-only" })
  const out = reassemble(turn.messages, msgs, conversion, "s1")
  assert.equal(out.length, 2)
  const textPart = out[0]!.content![0]! as { type: string; text: string }
  assert.ok((textPart.text as string).includes("m0"), "tag contains m-ref")
  assert.match(textPart.text as string, /<acp[^>]*>m0/)
  assert.ok((textPart.text as string).includes("hello world"), "original text preserved alongside tag")
})

test("processTurn is idempotent across dispatches (stale tags stripped)", () => {
  const core = createCore()
  const config = defaultConfig(200000)
  const msgs = [userMsg("msg_u1", "hello world")]
  const conversion = v2ToCoreMessages(msgs)
  const state = createInitialState()
  const turn1 = core.processTurn({ messages: conversion.cores, state, config, tokenCount: 100, renderTags: "text-only" })
  const tagged = turn1.messages[0]!.text!
  const turn2 = core.processTurn({ messages: conversion.cores, state: turn1.state, config, tokenCount: 100, renderTags: "text-only" })
  const tagged2 = turn2.messages[0]!.text!
  assert.match(tagged, /<acp/)
  assert.equal((tagged.match(/<acp/g) || []).length, 1, "no duplicate tags on second pass")
  assert.match(tagged2, /<acp/)
})

test("compress + reassembly replaces covered messages with synthetic user summary", () => {
  const core = createCore()
  const config = defaultConfig(200000, { preserveRecentMessages: 1, preserveRecentTokens: 0 })
  const u1Text = "u1content-".repeat(600)
  const a1Text = "a1content-".repeat(600)
  const msgs = [userMsg("msg_u1", u1Text), assistantMsg("msg_a1", a1Text), userMsg("msg_u2", "recent")]
  const conversion = v2ToCoreMessages(msgs)
  const init = createInitialState()
  const turn1 = core.processTurn({ messages: conversion.cores, state: init, config, tokenCount: 100, renderTags: "text-only" })
  const u1Mref = turn1.state.messageRefs.byRaw["msg_u1#t0"]
  const a1Mref = turn1.state.messageRefs.byRaw["msg_a1#t0"]
  assert.ok(u1Mref && a1Mref, "refs assigned")

  const applied = core.applyCompression({
    ranges: [{ startRef: u1Mref!, endRef: a1Mref!, summary: "SUMMARY: the old conversation about repeatable content was compressed into this block for testing the reassembly pipeline.", topic: "test" }],
    messages: conversion.cores,
    state: turn1.state,
    config,
  })
  assert.equal(applied.result.blocksCreated, 1)
  const turn2 = core.processTurn({ messages: conversion.cores, state: applied.state, config, tokenCount: 50, renderTags: "text-only" })
  const out = reassemble(turn2.messages, msgs, conversion, "s1")

  const summaryMsg = out.find((m) => m.id && m.id.startsWith("bili_summary_"))
  assert.ok(summaryMsg, "synthetic summary message injected")
  const text = summaryMsg!.content![0] as { text: string }
  assert.ok(text.text.includes("SUMMARY: the old conversation"))
  const hasA1 = out.some((m) => (m.content || []).some((p) => (p.text as string | undefined)?.includes("a1content")))
  assert.equal(hasA1, false, "covered assistant content pruned")
  const hasU2 = out.some((m) => (m.content || []).some((p) => (p.text as string | undefined)?.includes("recent")))
  assert.ok(hasU2, "recent uncompressed message preserved")
  const roles = out.map((m) => m.role)
  assert.ok(roles.includes("user"), "has at least one user message")
})

test("media-only messages survive the pipeline untouched", () => {
  const core = createCore()
  const config = defaultConfig(200000, { preserveRecentMessages: 1, preserveRecentTokens: 0 })
  const msgs = [userMsg("msg_u1", "x".repeat(600)), mediaMsg("msg_img"), userMsg("msg_u2", "recent")]
  const conversion = v2ToCoreMessages(msgs)
  const init = createInitialState()
  const turn1 = core.processTurn({ messages: conversion.cores, state: init, config, tokenCount: 100, renderTags: "text-only" })
  const ref = turn1.state.messageRefs.byRaw["msg_u1#t0"]
  const applied = core.applyCompression({
    ranges: [{ startRef: ref!, endRef: ref!, summary: "compressed u1", topic: "u1" }],
    messages: conversion.cores,
    state: turn1.state,
    config,
  })
  const turn2 = core.processTurn({ messages: conversion.cores, state: applied.state, config, tokenCount: 50, renderTags: "text-only" })
  const out = reassemble(turn2.messages, msgs, conversion, "s1")
  const img = out.find((m) => m.id === "msg_img")
  assert.ok(img, "media-only message preserved")
  assert.equal(img!.content![0]!.type, "media")
})

test("makeNudgeMessage produces a valid V2 user message", () => {
  const n = makeNudgeMessage("bili_nudge_0", "s1", "please compress")
  assert.equal(n.role, "user")
  assert.equal(n.content![0]!.type, "text")
  assert.equal((n.content![0] as { text: string }).text, "please compress")
})
