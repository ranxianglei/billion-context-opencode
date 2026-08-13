import { test } from "node:test"
import assert from "node:assert/strict"
import { createInitialState, type CoreMessage } from "acp-kernel"
import { AcpRuntime } from "@bili/core"

const cores: CoreMessage[] = [{ id: "u1#t0", role: "user", contentType: "text", text: "hello" }]

test("turn cache returns the transform tokenCount only for matching state, cores, and model limit", () => {
  const runtime = new AcpRuntime({})
  const state = createInitialState()
  const config = runtime.configFor(200000)
  const turn = runtime.core.processTurn({ messages: cores, state, config: config.kernel, tokenCount: 321, renderTags: "text-only" })
  runtime.setCores("cache-session", cores)
  runtime.cacheTurn("cache-session", turn.state, cores, 321, turn, config)

  const hit = runtime.getCachedTurnForInputs("cache-session", turn.state, cores, config)
  assert.equal(hit?.tokenCount, 321)
  assert.equal(hit?.result, turn)
  assert.equal(runtime.getCachedTurnForInputs("cache-session", turn.state, cores, runtime.configFor(128000)), undefined)

  const changedState = { ...turn.state, nextRunId: turn.state.nextRunId + 1 }
  assert.equal(runtime.getCachedTurnForInputs("cache-session", changedState, cores, config), undefined)

  const changedCores = [...cores]
  runtime.setCores("cache-session", changedCores)
  assert.equal(runtime.getCachedTurnForInputs("cache-session", turn.state, changedCores, config), undefined)
})

test("dropSession and LRU eviction do not retain stale turns", () => {
  const runtime = new AcpRuntime({})
  const state = createInitialState()
  const config = runtime.configFor(200000)
  const turn = runtime.core.processTurn({ messages: cores, state, config: config.kernel, tokenCount: 10, renderTags: "text-only" })
  runtime.setCores("drop-session", cores)
  runtime.cacheTurn("drop-session", turn.state, cores, 10, turn, config)
  runtime.dropSession("drop-session")
  assert.equal(runtime.getCachedTurnForInputs("drop-session", turn.state, cores, config), undefined)

  runtime.setCores("old-session", cores)
  runtime.cacheTurn("old-session", turn.state, cores, 10, turn, config)
  for (let i = 0; i < 33; i++) runtime.setCores(`new-session-${i}`, cores)
  assert.equal(runtime.getCachedTurnForInputs("old-session", turn.state, cores, config), undefined)
})
