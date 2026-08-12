import { defaultConfig, type Config as KernelConfig } from "acp-kernel"

export const FALLBACK_LIMIT = 200000

export interface AdapterConfig {
  modelContextLimit?: number
  protectedTools?: string[]
  preserveRecentMessages?: number
  debug?: boolean
  coreOverrides?: Partial<KernelConfig>
}

export interface ResolvedConfig {
  kernel: KernelConfig
  modelContextLimit: number
  protectedTools: string[]
  preserveRecentMessages: number
}

function envInt(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function resolveConfig(
  adapter: AdapterConfig,
  liveLimit?: number,
): ResolvedConfig {
  const modelContextLimit =
    adapter.modelContextLimit ??
    envInt("BILI_MODEL_CONTEXT_LIMIT") ??
    envInt("ACP_MODEL_CONTEXT_LIMIT") ??
    (liveLimit && liveLimit > 0 ? liveLimit : undefined) ??
    FALLBACK_LIMIT

  const protectedTools = adapter.protectedTools ?? []
  const preserveRecentMessages = adapter.preserveRecentMessages ?? 5

  // Defer nudge/threshold math to the kernel's own defaultConfig (it scales
  // growthFloor/growthCap from modelContextLimit); override via coreOverrides.
  const kernel: KernelConfig = defaultConfig(modelContextLimit, {
    protectedTools,
    preserveRecentMessages,
    ...adapter.coreOverrides,
  })

  return {
    kernel,
    modelContextLimit,
    protectedTools,
    preserveRecentMessages,
  }
}
