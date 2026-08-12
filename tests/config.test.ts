import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveConfig, FALLBACK_LIMIT, type AdapterConfig } from "../src/config.js"

const baseAdapter: AdapterConfig = {}

test("resolveConfig: no liveLimit and no override → FALLBACK_LIMIT (200000)", () => {
  const r = resolveConfig(baseAdapter)
  assert.equal(r.modelContextLimit, FALLBACK_LIMIT)
  assert.equal(r.modelContextLimit, 200000)
})

test("resolveConfig: liveLimit used when no adapter/env override", () => {
  const r = resolveConfig(baseAdapter, 32000)
  assert.equal(r.modelContextLimit, 32000)
})

test("resolveConfig: adapter.modelContextLimit wins over liveLimit", () => {
  const r = resolveConfig({ modelContextLimit: 128000 }, 32000)
  assert.equal(r.modelContextLimit, 128000)
})

test("resolveConfig: BILI_MODEL_CONTEXT_LIMIT env wins over liveLimit", () => {
  const prev = process.env.BILI_MODEL_CONTEXT_LIMIT
  process.env.BILI_MODEL_CONTEXT_LIMIT = "64000"
  try {
    const r = resolveConfig(baseAdapter, 32000)
    assert.equal(r.modelContextLimit, 64000)
  } finally {
    if (prev === undefined) delete process.env.BILI_MODEL_CONTEXT_LIMIT
    else process.env.BILI_MODEL_CONTEXT_LIMIT = prev
  }
})

test("resolveConfig: adapter override wins over env", () => {
  const prev = process.env.BILI_MODEL_CONTEXT_LIMIT
  process.env.BILI_MODEL_CONTEXT_LIMIT = "64000"
  try {
    const r = resolveConfig({ modelContextLimit: 128000 }, 32000)
    assert.equal(r.modelContextLimit, 128000)
  } finally {
    if (prev === undefined) delete process.env.BILI_MODEL_CONTEXT_LIMIT
    else process.env.BILI_MODEL_CONTEXT_LIMIT = prev
  }
})

test("resolveConfig: precedence is adapter > env > liveLimit > FALLBACK", () => {
  // env > liveLimit
  process.env.BILI_MODEL_CONTEXT_LIMIT = "64000"
  delete process.env.BILI_MODEL_CONTEXT_LIMIT
  const r = resolveConfig(baseAdapter, 8000)
  assert.equal(r.modelContextLimit, 8000)
})

// --- nudge thresholds deferred to kernel defaults (no adapter-level scheme) ---

test("resolveConfig: nudge thresholds come from kernel defaults (200K model)", () => {
  const r = resolveConfig(baseAdapter, 200000)
  assert.equal(r.kernel.nudge.growthCap, 50000)
  assert.equal(r.kernel.nudge.growthFloor, 50000)
})

test("resolveConfig: small-context model gets the same fixed thresholds", () => {
  const r = resolveConfig(baseAdapter, 32000)
  assert.equal(r.kernel.nudge.growthCap, 50000)
  assert.equal(r.kernel.nudge.growthFloor, 50000)
})

test("resolveConfig: coreOverrides flow into kernel config (power-user escape hatch)", () => {
  const r = resolveConfig({ coreOverrides: { promotionThreshold: 9 } }, 200000)
  assert.equal(r.kernel.promotionThreshold, 9)
})

test("resolveConfig: defaults pass through to kernel config", () => {
  const r = resolveConfig(baseAdapter, 200000)
  assert.deepEqual(r.protectedTools, [])
  assert.equal(r.preserveRecentMessages, 5)
})

test("resolveConfig: protectedTools + preserveRecentMessages flow into kernel", () => {
  const r = resolveConfig({ protectedTools: ["bash", "edit"], preserveRecentMessages: 8 }, 200000)
  assert.deepEqual(r.protectedTools, ["bash", "edit"])
  assert.equal(r.preserveRecentMessages, 8)
  assert.deepEqual(r.kernel.protectedTools, ["bash", "edit"])
  assert.equal(r.kernel.preserveRecentMessages, 8)
})
