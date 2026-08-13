import { test } from "node:test"
import assert from "node:assert/strict"
import { createInitialState, type CompressionState } from "acp-kernel"
import { extractLatestReportedUsage, selectV1TokenCount, usageInvalidatedByCompression } from "../src/usage-v1.js"
import type { OctoMessage, OctoTokenUsage } from "../src/messages-v1.js"

const SID = "usage-test-session"

function user(id: string, created: number, providerID = "openai", modelID = "gpt-test"): OctoMessage {
  return {
    info: { id, sessionID: SID, role: "user", time: { created }, model: { providerID, modelID } },
    parts: [],
  }
}

function assistant(
  id: string,
  created: number,
  tokens: OctoTokenUsage | undefined,
  extra: Record<string, unknown> = {},
): OctoMessage {
  return {
    info: {
      id,
      sessionID: SID,
      role: "assistant",
      time: { created },
      providerID: "openai",
      modelID: "gpt-test",
      ...(tokens === undefined ? {} : { tokens }),
      ...extra,
    },
    parts: [],
  }
}

function tokens(overrides: Partial<OctoTokenUsage> = {}): OctoTokenUsage {
  return {
    input: 10,
    output: 20,
    reasoning: 30,
    cache: { read: 40, write: 50 },
    ...overrides,
  }
}

function fullBlock(createdAt: number): CompressionState["blocks"][number] {
  return {
    blockId: "b1",
    runId: "r1",
    tier: 1,
    summary: "summary",
    directMessageIds: [],
    effectiveMessageIds: [],
    directBlockIds: [],
    compressedTokens: 1,
    createdAt,
    survivedCount: 0,
    generation: "young",
    active: true,
  }
}

test("reported usage sums all five components and accepts zero components", () => {
  const result = extractLatestReportedUsage([
    user("u1", 1),
    assistant("a1", 2, tokens({ total: 9999, input: 0, reasoning: 0 })),
  ])
  assert.equal(result.reason, "valid")
  assert.equal(result.usage?.total, 110)
  assert.equal(result.usage?.input, 0)
  assert.equal(result.usage?.reasoning, 0)
})

test("reported usage rejects missing, negative, NaN, Infinity, and all-zero fields", () => {
  const cases: Array<[string, OctoTokenUsage]> = [
    ["missing", { input: 1, output: 1, reasoning: 1, cache: { read: 1 } }],
    ["negative", tokens({ output: -1 })],
    ["NaN", tokens({ input: Number.NaN })],
    ["Infinity", tokens({ output: Number.POSITIVE_INFINITY })],
    ["zero", { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }],
  ]
  for (const [name, usage] of cases) {
    const result = extractLatestReportedUsage([user("u1", 1), assistant(`a-${name}`, 2, usage)])
    assert.notEqual(result.reason, "valid", name)
    assert.equal(result.usage, undefined, name)
  }
})

test("summary and error assistants are rejected", () => {
  const summary = extractLatestReportedUsage([user("u1", 1), assistant("a1", 2, tokens(), { summary: true })])
  assert.equal(summary.reason, "summary-assistant")
  const error = extractLatestReportedUsage([user("u1", 1), assistant("a2", 3, tokens(), { error: { message: "failed" } })])
  assert.equal(error.reason, "error-assistant")
})

test("latest assistant is selected by created time and id, not array order", () => {
  const result = extractLatestReportedUsage([
    user("u1", 1),
    assistant("a-new", 30, tokens({ input: 99 })),
    assistant("a-old", 20, tokens({ input: 1 })),
  ])
  assert.equal(result.reason, "valid")
  assert.equal(result.usage?.assistantId, "a-new")
  assert.equal(result.usage?.input, 99)

  const tie = extractLatestReportedUsage([
    user("u2", 1),
    assistant("a-2", 40, tokens({ input: 22 })),
    assistant("a-1", 40, tokens({ input: 11 })),
  ])
  assert.equal(tie.usage?.assistantId, "a-2")
  assert.equal(tie.usage?.input, 22)
})

test("invalid latest assistant does not reuse an older valid snapshot", () => {
  const result = extractLatestReportedUsage([
    user("u1", 1),
    assistant("a-old", 20, tokens({ input: 1 })),
    assistant("a-new", 30, undefined),
  ])
  assert.equal(result.reason, "missing-usage")
  assert.equal(result.usage, undefined)
})

test("invalid latest assistant timestamp cannot make an older usage snapshot look current", () => {
  const result = extractLatestReportedUsage([
    user("u1", 1),
    assistant("a-old", 20, tokens({ input: 1 })),
    assistant("a-new", Number.NaN, tokens({ input: 99 })),
  ])
  assert.equal(result.reason, "invalid-assistant-time")
  assert.equal(result.usage, undefined)
})

test("current user model mismatch rejects an otherwise valid snapshot", () => {
  const result = extractLatestReportedUsage([
    user("u1", 40, "anthropic", "claude"),
    assistant("a1", 41, tokens()),
  ])
  assert.equal(result.reason, "model-mismatch")
})

test("compression block before assistant accepts usage; block at or after rejects it", () => {
  const result = extractLatestReportedUsage([user("u1", 10), assistant("a1", 20, tokens())])
  assert.ok(result.usage)
  const before = createInitialState()
  before.blocks.push(fullBlock(19))
  assert.equal(usageInvalidatedByCompression(result.usage!, before), false)

  const at = createInitialState()
  at.blocks.push(fullBlock(20))
  assert.equal(usageInvalidatedByCompression(result.usage!, at), true)

  const after = createInitialState()
  after.blocks.push(fullBlock(21))
  assert.equal(usageInvalidatedByCompression(result.usage!, after), true)
})

test("V1 prefers a valid reported total whether it is larger or smaller than the estimate", () => {
  const msgs = [user("u1", 10), assistant("a1", 20, tokens({ input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } }))]
  const smaller = selectV1TokenCount(msgs, createInitialState(), 1000)
  assert.equal(smaller.source, "reported")
  assert.equal(smaller.tokenCount, 15)

  const larger = selectV1TokenCount(msgs, createInitialState(), 5)
  assert.equal(larger.source, "reported")
  assert.equal(larger.tokenCount, 15)
})

test("V1 falls back to estimation after compression and restores usage for a newer assistant", () => {
  const state = createInitialState()
  state.blocks.push(fullBlock(20))
  const old = [user("u1", 10), assistant("a1", 20, tokens())]
  const stale = selectV1TokenCount(old, state, 777)
  assert.equal(stale.source, "estimated")
  assert.equal(stale.tokenCount, 777)

  const newer = [user("u2", 30), assistant("a2", 31, tokens())]
  const restored = selectV1TokenCount(newer, state, 888)
  assert.equal(restored.source, "reported")
  assert.equal(restored.tokenCount, 150)
})
