import { promises as fs } from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { createInitialState, type CompressionState } from "acp-kernel"

const STATE_DIR = process.env.BILI_ACP_STATE_DIR || path.join(os.homedir(), ".cache", "opencode-bili-acp")

function stateFileFor(sessionId: string): string {
  return path.join(STATE_DIR, `${sessionId}.acp.json`)
}

/** Cap on the number of cached CompressionState objects in memory. Matches
 *  AcpRuntime.MAX_SESSIONS_IN_MEMORY so the store and runtime evict in step.
 *  Without a cap, a long-lived opencode process accumulates one state object
 *  per session ever seen — unbounded growth. */
const MAX_CACHED_STATES = 32

export class SessionStateStore {
  private cache = new Map<string, CompressionState>()

  async load(sessionId: string): Promise<CompressionState> {
    const hit = this.cache.get(sessionId)
    if (hit) {
      this.bump(sessionId, hit)
      return hit
    }
    let state = createInitialState()
    try {
      const raw = await fs.readFile(stateFileFor(sessionId), "utf8")
      const parsed = JSON.parse(raw) as CompressionState
      if (parsed && Array.isArray(parsed.blocks)) state = mergeInitialState(parsed)
    } catch {
    }
    this.bump(sessionId, state)
    return state
  }

  async save(state: CompressionState, sessionId: string): Promise<void> {
    this.bump(sessionId, state)
    const file = stateFileFor(sessionId)
    const dir = path.dirname(file)
    await fs.mkdir(dir, { recursive: true }).catch(() => {})
    const tmp = path.join(dir, `.bili-tmp-${sessionId}-${process.pid}`)
    await fs.writeFile(tmp, JSON.stringify(state), "utf8")
    await fs.rename(tmp, file)
  }

  /** Insert (or refresh) a cache entry and evict the least-recently-used entry
   *  if over cap. `delete` before `set` reorders Map insertion order so
   *  `keys()` yields entries oldest-first — that's what makes LRU eviction
   *  correct. Only the in-memory cache is dropped on eviction; disk state in
   *  ~/.cache/opencode-bili-acp is untouched and reloaded on next load(). */
  private bump(sessionId: string, state: CompressionState): void {
    this.cache.delete(sessionId)
    this.cache.set(sessionId, state)
    while (this.cache.size > MAX_CACHED_STATES) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }

  invalidate(sessionId?: string): void {
    if (sessionId) this.cache.delete(sessionId)
    else this.cache.clear()
  }
}

export function mergeInitialState(parsed: CompressionState): CompressionState {
  const fresh = createInitialState()
  const safeNextBlockId =
    typeof parsed.nextBlockId === "number" &&
    Number.isFinite(parsed.nextBlockId) &&
    parsed.nextBlockId > fresh.nextBlockId
      ? parsed.nextBlockId
      : fresh.nextBlockId
  const safeNextRunId =
    typeof parsed.nextRunId === "number" &&
    Number.isFinite(parsed.nextRunId) &&
    parsed.nextRunId > fresh.nextRunId
      ? parsed.nextRunId
      : fresh.nextRunId
  return {
    blocks: parsed.blocks ?? fresh.blocks,
    messageRefs: parsed.messageRefs ?? fresh.messageRefs,
    nudge: { ...fresh.nudge, ...(parsed.nudge ?? {}) },
    stats: { ...fresh.stats, ...(parsed.stats ?? {}) },
    nextBlockId: safeNextBlockId,
    nextRunId: safeNextRunId,
  }
}
