import assert from "node:assert/strict"
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { homedir, tmpdir } from "node:os"

const { default: plugin } = await import("./dist/index.js")
const sid = "v2-smoke-" + Date.now()

const tools = []
let contextHook = null
const ctx = {
  options: { preserveRecentMessages: 1, coreOverrides: { preserveRecentTokens: 0 } },
  tool: { transform: async (cb) => { cb({ add: (t) => tools.push(t) }); return { dispose: async () => {} } } },
  session: { hook: async (name, cb) => { if (name === "context") contextHook = cb; return { dispose: async () => {} } } },
  catalog: { model: { list: async () => ({ data: [{ id: "test-model", providerID: "test", limit: { context: 200000 } }] }) } },
}

const teardown = await plugin.setup(ctx)
assert.equal(plugin.id, "billion-context-opencode-v2")

const expected = ["bili_compress", "bili_decompress", "bili_search", "bili_status"]
const names = tools.map((t) => t.name)
assert.deepEqual(names, expected)
for (const t of tools) {
  assert.equal(typeof t.description, "string")
  assert.equal(t.input?.type, "object", `${t.name} has a JSON-schema input`)
  assert.equal(typeof t.execute, "function", `${t.name} has an execute function`)
}
console.log("✓ plugin id:", plugin.id)
console.log("✓ tools registered with V2 shape (name / description / input / execute):", names.join(", "))

function userMsg(id, text) {
  return { id, role: "user", content: [{ type: "text", text }] }
}
function assistantMsg(id, text) {
  return { id, role: "assistant", content: [{ type: "text", text }] }
}

const runHook = async (event) => {
  await contextHook(event)
  return event.messages
}
const extractRef = (msg) => {
  for (const part of msg.content ?? []) {
    if (part.type !== "text" || typeof part.text !== "string") continue
    const m = part.text.match(/<acp [^>]*>(m\d+)<\/acp>/)
    if (m) return m[1]
  }
  return null
}
const textOf = (msgs) => msgs.flatMap((m) => (m.content ?? []).filter((p) => p.type === "text").map((p) => p.text)).join("\n")

const u1 = userMsg("u1", "first user turn about topic A. " + "alpha ".repeat(1200))
const a1 = assistantMsg("a1", "assistant reply about A. " + "beta ".repeat(1200))
const u2 = userMsg("u2", "second user turn about topic B. " + "gamma ".repeat(1200))
const a2 = assistantMsg("a2", "assistant reply about B. " + "delta ".repeat(1200))
const u3 = userMsg("u3", "recent question: what is the status?")

const ev1 = { sessionID: sid, model: { id: "test-model", providerID: "test" }, system: [], messages: [u1, a1, u2, a2, u3], tools: {} }
let msgs = await runHook(ev1)
assert.equal(msgs.length, 5)
assert.ok(ev1.system.some((p) => p.type === "text" && p.text.includes("ACP TOOLS (billion-context)")), "system marker present")
const u2Ref = extractRef(msgs[2])
const a2Ref = extractRef(msgs[3])
assert.ok(u2Ref && a2Ref, "refs extractable")
console.log("✓ context hook ran, msgs:", msgs.length, "| refs:", u2Ref, a2Ref)

await runHook(ev1)
const markerCount = ev1.system.filter((p) => p.type === "text" && p.text.includes("ACP TOOLS (billion-context)")).length
assert.equal(markerCount, 1, "system marker not duplicated")
const textPartCount = ev1.messages.flatMap((m) => (m.content ?? []).filter((p) => p.type === "text")).length
const tagCount = (textOf(ev1.messages).match(/<acp /g) ?? []).length
assert.equal(tagCount, textPartCount, "exactly one tag per text part (idempotent)")
console.log("✓ idempotent across dispatches")

const statusTool = tools.find((t) => t.name === "bili_status")
const statusRes = await statusTool.execute({}, { sessionID: sid })
assert.equal(typeof statusRes.content, "string")
console.log("✓ bili_status -> { content: string } (" + statusRes.content.length + " chars)")

const compressTool = tools.find((t) => t.name === "bili_compress")
const compressRes = await compressTool.execute(
  { content: [{ startId: u2Ref, endId: a2Ref, summary: "Second user turn about topic B, gamma/delta content.", topic: "v2-smoke" }] },
  { sessionID: sid, id: "call-v2-1" },
)
assert.equal(typeof compressRes.content, "string")
assert.ok(compressRes.content.includes("bili ACP"), "compress summary line")
console.log("✓ bili_compress -> { content } (" + compressRes.content.length + " chars)")

const statePath = join(homedir(), ".cache", "opencode-bili-acp", `${sid}.acp.json`)
const state = JSON.parse(await readFile(statePath, "utf8"))
assert.equal(state.blocks[0]?.compressCallId, "call-v2-1", "compressCallId mapped from V2 ctx.id")
console.log("✓ compressCallId mapped from V2 ctx.id:", state.blocks[0].compressCallId)

const ev2 = { sessionID: sid, model: { id: "test-model", providerID: "test" }, system: [], messages: [u1, a1, u2, a2, u3], tools: {} }
msgs = await runHook(ev2)
assert.ok(textOf(msgs).includes("[Compressed conversation section]"), "summary placeholder present")
assert.ok(!textOf(msgs).includes("gamma gamma"), "compressed content pruned")
console.log("✓ after compress: summary present, old content pruned, msgs:", msgs.length)

const searchTool = tools.find((t) => t.name === "bili_search")
const searchRes = await searchTool.execute({ query: "topic B gamma" }, { sessionID: sid })
assert.equal(typeof searchRes.content, "string")
assert.ok(/block b\d|b\d/.test(searchRes.content), "search found the block")
console.log("✓ bili_search -> { content }")

const decompTool = tools.find((t) => t.name === "bili_decompress")
const decompRes = await decompTool.execute({ blockId: "b1", inline: true }, { sessionID: sid })
assert.equal(typeof decompRes.content, "string")
assert.ok(decompRes.content.includes("topic B"), "decompressed content restored")
console.log("✓ bili_decompress -> { content }")

await teardown()
await rm(statePath, { force: true })
console.log("\n=== ALL V2 SMOKE TESTS PASSED ===")
