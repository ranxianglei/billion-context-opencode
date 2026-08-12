import {
  createCore,
  type CompressionCore,
  type CompressionState,
  type CoreMessage,
  type ProcessTurnResult,
} from "acp-kernel"
import { SessionStateStore } from "./state.js"
import { resolveConfig, type AdapterConfig, type ResolvedConfig } from "./config.js"
import { debug } from "./log.js"

/** Max number of sessions kept in memory. The persistent state lives on disk;
 *  these maps only hold the uncompressed `cores` cache + bookkeeping. Without
 *  a cap, a long-lived process with many sessions leaks the full uncompressed
 *  conversation per session — exactly what compression is meant to reduce. */
const MAX_SESSIONS_IN_MEMORY = 32

interface TurnCacheEntry {
  /** Identity of the state the result was computed from (reference equality),
   *  so a stale cache is detected after a compress writes a new state object. */
  state: CompressionState
  cores: CoreMessage[]
  tokenCount: number
  result: ProcessTurnResult
}

export class AcpRuntime {
  readonly core: CompressionCore = createCore()
  private store = new SessionStateStore()
  private adapter: AdapterConfig
  private locks = new Map<string, Promise<unknown>>()
  private cores = new Map<string, CoreMessage[]>()
  private modelLimits = new Map<string, number>()
  private turnCache = new Map<string, TurnCacheEntry>()
  /** Resolved config cache keyed by live model limit. `this.adapter` is fixed
   *  after plugin init, so the only varying input is the per-session model
   *  context limit — cache on it so the hot transform/status paths don't
   *  rebuild (and reallocate) the whole kernel config on every call. */
  private configCache = new Map<number, ResolvedConfig>()

  constructor(adapter: AdapterConfig) {
    this.adapter = adapter
  }

  configFor(liveLimit?: number): ResolvedConfig {
    const key = liveLimit && liveLimit > 0 ? liveLimit : 0
    const hit = this.configCache.get(key)
    if (hit) return hit
    const resolved = resolveConfig(this.adapter, key > 0 ? key : undefined)
    this.configCache.set(key, resolved)
    return resolved
  }

  async stateFor(sessionId: string): Promise<CompressionState> {
    return this.store.load(sessionId)
  }

  async save(state: CompressionState, sessionId: string): Promise<void> {
    await this.store.save(state, sessionId)
  }

  /** Cache a processTurn result so bili_status can reuse it instead of
   *  recomputing the full pipeline. Only valid until the next save/cores change. */
  cacheTurn(sessionId: string, state: CompressionState, cores: CoreMessage[], tokenCount: number, result: ProcessTurnResult): void {
    this.turnCache.set(sessionId, { state, cores, tokenCount, result })
  }

  /** Return a cached processTurn result if it is still fresh (same cores array
   *  reference + same state reference + same tokenCount). bili_status uses this
   *  to avoid recomputing the pipeline on every call. Returns undefined if stale. */
  getCachedTurn(sessionId: string, state: CompressionState, cores: CoreMessage[], tokenCount: number): ProcessTurnResult | undefined {
    const entry = this.turnCache.get(sessionId)
    if (!entry) return undefined
    if (entry.state !== state || entry.cores !== cores || entry.tokenCount !== tokenCount) return undefined
    return entry.result
  }

  /** Serialize async work per session. `fn` runs only after all previously
   *  queued work for `sessionId` has settled (success OR failure — failures
   *  don't block the chain).
   *
   *  Contract: the returned promise REJECTS if `fn` rejects. Callers MUST
   *  attach a .catch() (or await in a try/catch) — the stored chain is
   *  suppressed internally so it never surfaces as an unhandled rejection,
   *  but the caller-observed promise is the raw `next` and will throw.
   *  All current callers (messages.transform hook, the four bili_ tools)
   *  catch it. */
  acquireLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(sessionId) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    // Store a suppressed copy so a rejection never surfaces as an unhandled
    // rejection on the stored chain; the caller still observes `next` directly.
    const stored = next.catch(() => {})
    this.locks.set(sessionId, stored)
    // Drop the lock entry once settled, but only if no newer lock has queued
    // behind it in the meantime (otherwise we'd truncate a pending chain).
    stored.then(() => {
      if (this.locks.get(sessionId) === stored) this.locks.delete(sessionId)
    })
    return next
  }

  setCores(sessionId: string, cores: CoreMessage[]): void {
    this.touch(sessionId)
    // New cores array → cached processTurn result is stale.
    this.turnCache.delete(sessionId)
    this.cores.set(sessionId, cores)
  }

  getCores(sessionId: string): CoreMessage[] | undefined {
    return this.cores.get(sessionId)
  }

  setModelLimit(sessionId: string, limit: number): void {
    this.touch(sessionId)
    this.modelLimits.set(sessionId, limit)
  }

  getModelLimit(sessionId: string): number | undefined {
    return this.modelLimits.get(sessionId)
  }

  /** Drop all in-memory state for a session. Persistent state on disk is
   *  untouched. Safe to call repeatedly.
   *
   *  NOTE: not currently wired to any opencode lifecycle event — opencode's
   *  plugin API exposes no stable session-end signal as of v1.14. In-memory
   *  release therefore relies on the LRU cap in `touch()` (MAX_SESSIONS_IN_MEMORY).
   *  This method exists so a future session-end hook can call it directly. */
  dropSession(sessionId: string): void {
    this.cores.delete(sessionId)
    this.modelLimits.delete(sessionId)
    this.locks.delete(sessionId)
    this.turnCache.delete(sessionId)
    this.store.invalidate(sessionId)
    debug("drop-session", { sid: sessionId })
  }

  /** Drop all in-memory state (plugin unload / reload). Disk state is kept. */
  dropAll(): void {
    this.cores.clear()
    this.modelLimits.clear()
    this.locks.clear()
    this.turnCache.clear()
    this.store.invalidate()
  }

  /** Mark a session as recently used (moves it to the end of insertion order)
   *  and evict the oldest session if we've exceeded the cap. */
  private touch(sessionId: string): void {
    // Re-insert to bump to MRU position for LRU eviction.
    const c = this.cores.get(sessionId)
    if (c !== undefined) {
      this.cores.delete(sessionId)
      this.cores.set(sessionId, c)
    }
    const m = this.modelLimits.get(sessionId)
    if (m !== undefined) {
      this.modelLimits.delete(sessionId)
      this.modelLimits.set(sessionId, m)
    }
    while (this.cores.size > MAX_SESSIONS_IN_MEMORY) {
      const oldest = this.cores.keys().next().value
      if (oldest === undefined) break
      debug("evict-session", { sid: oldest, size: this.cores.size })
      this.cores.delete(oldest)
      this.modelLimits.delete(oldest)
      this.turnCache.delete(oldest)
      // Intentionally NOT deleting this.locks[oldest]: the lock entry is a
      // promise chain, not a cache. Removing a still-pending chain would make
      // the next acquireLock for that session chain onto Promise.resolve()
      // instead, racing with the in-flight work and corrupting compressed
      // state (two concurrent compress() writes to the same session file).
      // The lock entry self-deletes on settle (see acquireLock), and locks
      // are tiny (one Promise per session) so keeping them is cheap.
    }
  }
}
