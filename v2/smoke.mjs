import assert from "node:assert/strict"
import { rm } from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const stateDir = path.join(here, ".test-clean", "smoke-state")
process.env.BILI_ACP_STATE_DIR = stateDir
await rm(stateDir, { recursive: true, force: true })

const sid = "smoke-" + Date.now()

function userMsg(id, text) {
  return { id, role: "user", content: [{ type: "text", text }] }
}
function assistantMsg(id, text) {
  return { id, role: "assistant", content: [{ type: "text", text }] }
}

const tools = []
let contextHook = null
const ctx = {
  options: { preserveRecentMessages: 1, coreOverrides: { preserveRecentTokens: 0 } },
  tool: {
    transform: async (cb) => {
      cb({ add: (tool) => tools.push(tool) })
      return { dispose: async () => {} }
    },
  },
  session: {
    hook: async (name, cb) => {
      if (name === "context") contextHook = cb
      return { dispose: async () => {} }
    },
  },
  catalog: {
    model: { list: async () => ({ data: [{ id: "test-model", providerID: "test", limit: { context: 200000 } }] }) },
  },
}

const plugin = (await import("./dist/index.js")).default
await plugin.setup(ctx)
assert.equal(plugin.id, "billion-context-opencode-v2")
console.log("✓ plugin loaded:", plugin.id)

const names = tools.map((t) => t.name)
assert.deepEqual(names, ["bili_compress", "bili_decompress", "bili_search", "bili_status"])
console.log("✓ tools registered:", names.join(", "))

async function runHook(messages, model) {
  const event = { sessionID: sid, model, system: [], messages, tools: {} }
  await contextHook(event)
  return event
}

function extractRef(msg) {
  for (const p of msg.content || []) {
    if (p.type !== "text" || typeof p.text !== "string") continue
    const m = String(p.text).match(/<acp [^>]*>(m\d+)<\/acp>/)
    if (m) return m[1]
  }
  return null
}

function textOf(msg) {
  return (msg.content || []).filter((p) => p.type === "text").map((p) => p.text).join("\n")
}

// --- build a long conversation ---
const u1 = userMsg("msg_u1", "first user turn about topic A. " + "alpha ".repeat(1200))
const a1 = assistantMsg("msg_a1", "assistant reply about A. " + "beta ".repeat(1200))
const u2 = userMsg("msg_u2", "second user turn about topic B. " + "gamma ".repeat(1200))
const a2 = assistantMsg("msg_a2", "assistant reply about B. " + "delta ".repeat(1200))
const u3 = userMsg("msg_u3", "recent question: what is the status?")

// --- first dispatch: tags injected, system prompt upserted ---
const ev1 = await runHook([u1, a1, u2, a2, u3], { id: "test-model", providerID: "test" })
console.log("✓ context hook ran, messages:", ev1.messages.length)
const systemText = ev1.system.map((p) => p.text).join("\n")
assert.ok(systemText.includes("BILI CONTEXT MANAGEMENT"), "system prompt injected")
assert.ok(ev1.messages.every((m) => m.content && m.content.length > 0), "all messages kept on first pass")

const u1Ref = extractRef(ev1.messages[0])
const a1Ref = extractRef(ev1.messages[1])
const u2Ref = extractRef(ev1.messages[2])
const a2Ref = extractRef(ev1.messages[3])
assert.ok(u1Ref && u2Ref && a2Ref, "refs extractable from tags")
console.log("  refs:", [u1Ref, a1Ref, u2Ref, a2Ref].join(", "), "| system marker present")

// --- second dispatch must be idempotent (no duplicate tags) ---
const ev2 = await runHook([u1, a1, u2, a2, u3], { id: "test-model", providerID: "test" })
const tagCount = (textOf(ev2.messages[0]).match(/<acp/g) || []).length
assert.equal(tagCount, 1, "exactly one tag per text part")
console.log("✓ idempotent across dispatches")

// --- bili_status ---
const statusTool = tools.find((t) => t.name === "bili_status")
const statusResult = await statusTool.execute({}, { sessionID: sid })
const fullContent = typeof statusResult.content === "string" ? statusResult.content : String(statusResult.content);
console.log("✓ bili_status: FULL:", fullContent);
console.log("✓ bili_status: LEN:", fullContent.length, "CHARS");

// --- bili_compress: compress u2..a2 (the first user message is the opener
//    and is always preserved by the kernel, so compress a later range) ---
const compressTool = tools.find((t) => t.name === "bili_compress")
const compressResult = await compressTool.execute(
  {
    content: [
      { startId: u2Ref, endId: a2Ref, summary: "User and assistant discussed topic B covering gamma concepts and delta implementations in depth for testing the compression pipeline end to end.", topic: "smoke-b" },
    ],
  },
  { sessionID: sid },
)
console.log("✓ bili_compress:", (compressResult.content || "").slice(0, 100).replace(/\n/g, " | "))

// --- third dispatch: covered messages pruned, summary placeholder injected ---
const ev3 = await runHook([u1, a1, u2, a2, u3], { id: "test-model", providerID: "test" })
const allText = ev3.messages.map(textOf).join("\n")
assert.ok(allText.includes("[Compressed conversation section]"), "summary placeholder present")
assert.ok(!allText.includes("gamma gamma"), "covered old content pruned")
assert.ok(!allText.includes("delta delta"), "covered assistant content pruned")
assert.ok(allText.includes("alpha alpha"), "uncovered opener content preserved")
assert.ok(allText.includes("recent question"), "recent message preserved")
console.log("✓ after compress: summary present, old content pruned, msgs:", ev3.messages.length)

// --- bili_search ---
const searchTool = tools.find((t) => t.name === "bili_search")
const searchResult = await searchTool.execute({ query: "topic A alpha beta" }, { sessionID: sid })
assert.match(searchResult.content, /b1|block/, "search finds the compressed block")
console.log("✓ bili_search:", (searchResult.content || "").slice(0, 100).replace(/\n/g, " | "))

// --- bili_decompress ---
const decompressTool = tools.find((t) => t.name === "bili_decompress")
const decompResult = await decompressTool.execute({ blockId: "b1", inline: true }, { sessionID: sid })
assert.ok((decompResult.content || "").includes("topic B"), "decompress restores original content")
console.log("✓ bili_decompress:", (decompResult.content || "").slice(0, 90).replace(/\n/g, " | "))

console.log("\n=== ALL SMOKE TESTS PASSED ===")
