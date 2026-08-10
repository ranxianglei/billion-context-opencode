import { test } from "node:test"
import assert from "node:assert/strict"
import { createInitialState, type CompressionState } from "acp-kernel"
import { mergeInitialState, SessionStateStore } from "../src/state.js"

const fresh = createInitialState()

function stateWith(over: Partial<CompressionState>): CompressionState {
  return { ...fresh, ...over }
}

test("mergeInitialState: well-formed parsed state passes through", () => {
  const parsed = stateWith({ nextBlockId: 7, nextRunId: 3, blocks: [{ blockId: "b1" } as unknown as CompressionState["blocks"][number]] })
  const merged = mergeInitialState(parsed)
  assert.equal(merged.nextBlockId, 7)
  assert.equal(merged.nextRunId, 3)
  assert.equal(merged.blocks.length, 1)
})

test("mergeInitialState: non-finite nextBlockId falls back to fresh", () => {
  const parsed = stateWith({ nextBlockId: Number.NaN })
  const merged = mergeInitialState(parsed)
  assert.equal(merged.nextBlockId, fresh.nextBlockId)
})

test("mergeInitialState: negative nextBlockId falls back to fresh", () => {
  const parsed = stateWith({ nextBlockId: -5 })
  const merged = mergeInitialState(parsed)
  assert.equal(merged.nextBlockId, fresh.nextBlockId)
})

test("mergeInitialState: non-finite nextRunId falls back to fresh", () => {
  const parsed = stateWith({ nextRunId: Number.POSITIVE_INFINITY })
  const merged = mergeInitialState(parsed)
  assert.equal(merged.nextRunId, fresh.nextRunId)
})

test("mergeInitialState: regressed nextRunId (below fresh) is rejected", () => {
  const parsed = stateWith({ nextRunId: 0 })
  const merged = mergeInitialState(parsed)
  assert.equal(merged.nextRunId, fresh.nextRunId)
})

test("mergeInitialState: missing blocks array falls back to fresh", () => {
  const parsed = { nextBlockId: 5, nextRunId: 2 } as CompressionState
  const merged = mergeInitialState(parsed)
  assert.deepEqual(merged.blocks, fresh.blocks)
  assert.equal(merged.nextBlockId, 5)
})

test("mergeInitialState: nudge/stats merge preserves fresh defaults for missing keys", () => {
  const parsed = stateWith({
    // @ts-expect-error partial nudge shape from older file
    nudge: { lastCompressTokenCount: 1000 },
  })
  const merged = mergeInitialState(parsed)
  assert.equal((merged.nudge as { lastCompressTokenCount?: number }).lastCompressTokenCount, 1000)
})

// --- SessionStateStore LRU ---

test("SessionStateStore.load returns fresh state for unknown session (no disk)", async () => {
  const store = new SessionStateStore()
  const s = await store.load("nonexistent-session-for-test")
  assert.deepEqual(s.blocks, fresh.blocks)
  assert.equal(s.nextBlockId, fresh.nextBlockId)
})

test("SessionStateStore round-trips save → load", async () => {
  const store = new SessionStateStore()
  const sid = "roundtrip-test-session"
  const original = stateWith({ nextBlockId: 42, nextRunId: 7 })
  await store.save(original, sid)
  const loaded = await store.load(sid)
  assert.equal(loaded.nextBlockId, 42)
  assert.equal(loaded.nextRunId, 7)
})
