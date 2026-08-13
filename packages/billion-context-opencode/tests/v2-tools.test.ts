import { test } from "node:test"
import assert from "node:assert/strict"
import { AcpRuntime, SYSTEM_PROMPT } from "@bili/core"
import {
  makeV2CompressTool,
  makeV2DecompressTool,
  makeV2SearchTool,
  makeV2StatusTool,
} from "../src/v2-tools.js"
import { SYSTEM_MARKER } from "../src/index.js"

const runtime = new AcpRuntime({})
const allTools = [
  makeV2CompressTool(runtime),
  makeV2DecompressTool(runtime),
  makeV2SearchTool(runtime),
  makeV2StatusTool(runtime),
]
const expectedNames = ["bili_compress", "bili_decompress", "bili_search", "bili_status"]

test("V2 tools expose the AI-SDK shape { name, description, input(JSON schema), execute }", () => {
  for (let i = 0; i < allTools.length; i++) {
    const t = allTools[i]!
    assert.equal(t.name, expectedNames[i], `tool ${i} name`)
    assert.equal(typeof t.description, "string")
    assert.ok(t.description.length > 0, `${t.name}: description non-empty`)
    assert.equal(t.input.type, "object", `${t.name}: input.type === "object"`)
    assert.ok(t.input.properties && typeof t.input.properties === "object", `${t.name}: input has properties`)
    assert.equal(typeof t.execute, "function", `${t.name}: execute is a function`)
  }
})

test("V2 compress input schema mirrors the V1 zod args (no drift)", () => {
  const props = makeV2CompressTool(runtime).input.properties as Record<string, { type?: string; items?: { properties?: Record<string, unknown> } }>
  assert.equal(props.content?.type, "array")
  const itemProps = props.content!.items!.properties!
  for (const key of ["startId", "endId", "summary"]) {
    assert.ok(itemProps[key], `content item has ${key}`)
  }
  assert.deepEqual(makeV2CompressTool(runtime).input.required, ["content"])
})

test("V2 execute maps the V2 ctx onto the V1 ctx and unwraps the result into { content }", async () => {
  const res = await makeV2StatusTool(runtime).execute(
    {},
    { sessionID: "v2-tools-test", id: "call-42", agent: "a", messageID: "m1" },
  )
  assert.equal(typeof res.content, "string")
  assert.ok(res.content.length > 0)
})

test("SYSTEM_MARKER matches the SYSTEM_PROMPT header so the V2 upsert stays idempotent", () => {
  assert.ok(
    SYSTEM_PROMPT.includes(SYSTEM_MARKER),
    `SYSTEM_MARKER "${SYSTEM_MARKER}" must appear in SYSTEM_PROMPT or the V2 hook appends a duplicate prompt every dispatch`,
  )
})
