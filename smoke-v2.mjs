import assert from "node:assert/strict"
import { rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import plugin from "./packages/billion-context-opencode/dist/index.js"

const stateDir = path.join(os.tmpdir(), "bili-dual-v2-" + Date.now())
process.env.BILI_ACP_STATE_DIR = stateDir

const tools = []
let contextHook = null

const ctx = {
  options: { preserveRecentMessages: 1, coreOverrides: { preserveRecentTokens: 0 } },
  tool: {
    transform: async (cb) => {
      cb({ add: (t) => tools.push(t) })
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
    model: {
      list: async () => ({ data: [{ id: "test-model", providerID: "test", limit: { context: 200000 } }] }),
    },
  },
}

// --- Dual-shape contract: the default MUST be a plain object. opencode V2's
// loader validates it with Schema.Struct({ id, setup | effect }) and rejects
// functions ("Expected object, got async function"); opencode V1's loader
// (readV1Plugin, detect mode) accepts an object with id + server(). ---
assert.equal(typeof plugin, "object", "default must be an object (V2 host rejects functions)")
assert.equal(plugin.id, "billion-context-opencode")
assert.equal(typeof plugin.server, "function", "V1 entry point server() present")
assert.equal(typeof plugin.setup, "function", "V2 entry point setup() present")

const teardown = await plugin.setup(ctx)
assert.equal(typeof teardown, "function", "setup must return a cleanup fn")

assert.deepEqual(
  tools.map((t) => t.name),
  ["bili_compress", "bili_decompress", "bili_search", "bili_status"],
)
assert.ok(contextHook, "session.hook('context') registered")

const sid = "dual-v2-" + Date.now()
const text = (t) => t.content.filter((p) => p.type === "text").map((p) => p.text).join("")
const userMsg = (id, t) => ({ id, role: "user", content: [{ type: "text", text: t }] })
const assistantMsg = (id, t) => ({ id, role: "assistant", content: [{ type: "text", text: t }] })

const u1 = userMsg("u1", "first turn. " + "alpha ".repeat(1200))
const a1 = assistantMsg("a1", "reply one. " + "beta ".repeat(1200))
const u2 = userMsg("u2", "second turn. " + "gamma ".repeat(1200))
const a2 = assistantMsg("a2", "reply two. " + "delta ".repeat(1200))
const u3 = userMsg("u3", "recent question: status?")

const runHook = async (messages) => {
  const event = { sessionID: sid, model: { id: "test-model", providerID: "test" }, system: [], messages, tools: {} }
  await contextHook(event)
  return event
}

let ev = await runHook([u1, a1, u2, a2, u3])
assert.ok(
  ev.system.some((p) => (p.text ?? "").includes("ACP TOOLS (billion-context)")),
  "system marker present",
)
const refs = ev.messages.map((m) => m.content.filter((p) => p.type === "text").map((p) => p.text).join("")).join("\n").match(/<acp [^>]*>(m\d+)<\/acp>/g) ?? []
assert.ok(refs.length >= 2, `refs injected (got ${refs.length})`)

const statusTool = tools.find((t) => t.name === "bili_status")
const statusOut = await statusTool.execute({}, { sessionID: sid })
assert.equal(typeof statusOut.content, "string", "status returns {content}")

const compressTool = tools.find((t) => t.name === "bili_compress")
const refOf = (msg) => {
  const m = text(msg).match(/<acp [^>]*>(m\d+)<\/acp>/)
  return m ? m[1] : null
}
const u2Ref = refOf(ev.messages.find((m) => m.id === "u2"))
const a2Ref = refOf(ev.messages.find((m) => m.id === "a2"))
assert.ok(u2Ref && a2Ref, `refs found (u2=${u2Ref} a2=${a2Ref})`)

const summary =
  "smoke-b: this range covers the second user turn and its assistant reply on topic B (gamma and delta content). Enough words to clear the fifty character minimum summary length threshold."
const cOut = await compressTool.execute(
  { content: [{ startId: u2Ref, endId: a2Ref, summary, topic: "dual-v2" }] },
  { sessionID: sid, id: "call-dual-1" },
)
assert.match(cOut.content ?? "", /bili ACP \|/, "compress returns ACP report")

ev = await runHook([u1, a1, u2, a2, u3])
const allText = ev.messages.map(text).join("\n")
assert.ok(allText.includes("first turn"), "opener kept")
assert.ok(allText.includes("recent question"), "recent kept")

const searchTool = tools.find((t) => t.name === "bili_search")
const sOut = await searchTool.execute({ query: "alpha beta" }, { sessionID: sid })
assert.equal(typeof sOut.content, "string", "search returns {content}")

const decompressTool = tools.find((t) => t.name === "bili_decompress")
const dOut = await decompressTool.execute({ blockId: "b1", inline: true }, { sessionID: sid })
assert.ok(String(dOut.content).includes("gamma"), "decompress restores block content")

await teardown()
await rm(stateDir, { recursive: true, force: true })
console.log("=== DUAL V2 SETUP PATH: ALL PASSED ===")
