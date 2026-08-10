const DEBUG = Boolean(process.env.BILI_ACP_DEBUG || process.env.ACP_DEBUG)

function ts(): string {
  return new Date().toISOString().slice(11, 23)
}

export function debug(...args: unknown[]): void {
  if (!DEBUG) return
  console.error(`[bili-acp ${ts()}]`, ...args)
}

export function warn(...args: unknown[]): void {
  console.error(`[bili-acp ${ts()}] WARN`, ...args)
}
