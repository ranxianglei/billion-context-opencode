import assert from "node:assert/strict"
import { rm } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import plugin from "./packages/billion-context-opencode/dist/index.js"

const sid = "smoke-" + Date.now()
const stateFile = join(homedir(), ".cache", "opencode-bili-acp", `${sid}.acp.json`)
const now = Date.now()

function userMsg(id, text) {
  return {
    info: { id, sessionID: sid, role: "user", time: { created: now }, agent: "build", model: { providerID: "x", modelID: "y" } },
    parts: [{ id: `${id}_p`, sid, messageID: id, type: "text", text }],
  }
}
function assistantMsg(id, text) {
  return {
    info: { id, sessionID: sid, role: "assistant", time: { created: now }, parentID: "p", modelID: "y", providerID: "x", mode: "default", path: { cwd: "/", root: "/" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
    parts: [{ id: `${id}_p`, sid, messageID: id, type: "text", text }],
  }
}

const hooks = await plugin({ project: { id: "t", name: "t" }, directory: "/tmp" }, {})

// --- system.transform: captures model, injects prompt ---
const sysOut = { system: [] }
await hooks["experimental.chat.system.transform"]({ sessionID: sid, model: { limit: { context: 200000, output: 8000 } } }, sysOut)
assert.ok(sysOut.system.length > 0, "system prompt injected")
console.log("✓ system.transform injected", sysOut.system.length, "block(s)")

// --- build a conversation with large old content ---
const u1 = userMsg("u1", "first user turn about topic A. " + "alpha ".repeat(1200))
const a1 = assistantMsg("a1", "assistant reply about A. " + "beta ".repeat(1200))
const u2 = userMsg("u2", "second user turn about topic B. " + "gamma ".repeat(1200))
const a2 = assistantMsg("a2", "assistant reply about B. " + "delta ".repeat(1200))
const u3 = userMsg("u3", "third turn about C. " + "epsilon ".repeat(600))
const a3 = assistantMsg("a3", "reply about C. " + "zeta ".repeat(600))
const u4 = userMsg("u4", "fourth turn about D. " + "eta ".repeat(600))
const a4 = assistantMsg("a4", "reply about D. " + "theta ".repeat(600))
const u5 = userMsg("u5", "recent question: what is the status?")

// --- messages.transform: runs pipeline, tags messages ---
const mout = { messages: [u1, a1, u2, a2, u3, a3, u4, a4, u5] }
await hooks["experimental.chat.messages.transform"]({}, mout)
console.log("✓ messages.transform ran, output msgs:", mout.messages.length)
const tagged = mout.messages.some((m) => m.parts.some((p) => p.text && p.text.includes("<acp ")))
console.log("  ref tags injected:", tagged)

function extractRef(msg) {
  for (const p of msg.parts) {
    if (!p.text) continue
    const m = String(p.text).match(/<acp [^>]*>(m\d+)<\/acp>/)
    if (m) return m[1]
  }
  return null
}
const u1Ref = extractRef(mout.messages[0])
const a1Ref = extractRef(mout.messages[1])
const u2Ref = extractRef(mout.messages[2])
const endRef = a1Ref ?? u2Ref
console.log("  u1 ref:", u1Ref, "| compression end ref:", endRef)
assert.ok(u1Ref && endRef, "compression boundary refs extractable from tags")

// --- bili_status tool ---
const statusResult = await hooks.tool.bili_status.execute({}, { sessionID: sid, messageID: "m_status", callID: "call_status", agent: "build", directory: "/tmp", abort: new AbortController().signal, metadata: () => {}, ask: async () => ({}) })
console.log("✓ bili_status returned", typeof statusResult === "string" ? statusResult.slice(0, 80) + "..." : "object")

// --- bili_compress tool: compress the oldest visible range ---
const compressResult = await hooks.tool.bili_compress.execute({
  content: [{ startId: u1Ref, endId: endRef, summary: "User and assistant discussed topic A in detail, covering alpha concepts and beta implementations across many repetitions for testing the compression pipeline end to end." }],
}, { sessionID: sid, messageID: "m_compress", callID: "call_compress", agent: "build", directory: "/tmp", abort: new AbortController().signal, metadata: () => {}, ask: async () => ({}) })
console.log("✓ bili_compress:", compressResult.slice(0, 100))

// --- messages.transform again: should show pruned + summary ---
const mout2 = { messages: [u1, a1, u2, a2, u3, a3, u4, a4, u5] }
await hooks["experimental.chat.messages.transform"]({}, mout2)
const hasSummary = mout2.messages.some((m) => m.parts.some((p) => p.text && p.text.includes("[Compressed conversation section]")))
console.log("✓ after compress, summary present:", hasSummary, "| msgs:", mout2.messages.length)

// --- bili_search tool ---
const searchResult = await hooks.tool.bili_search.execute({ query: "topic A alpha beta" }, { sessionID: sid, messageID: "m_search", callID: "call_search", agent: "build", directory: "/tmp", abort: new AbortController().signal, metadata: () => {}, ask: async () => ({}) })
console.log("✓ bili_search:", searchResult.slice(0, 100))

// --- bili_decompress tool ---
const decompResult = await hooks.tool.bili_decompress.execute({ blockId: "b1", inline: true }, { sessionID: sid, messageID: "m_decomp", callID: "call_decomp", agent: "build", directory: "/tmp", abort: new AbortController().signal, metadata: () => {}, ask: async () => ({}) })
console.log("✓ bili_decompress:", decompResult.slice(0, 100))

await rm(stateFile, { force: true })
console.log("\n=== ALL SMOKE TESTS PASSED ===")
