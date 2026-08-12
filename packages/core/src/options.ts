export function numOpt(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined
  if (typeof v === "string" && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}
export function strArrayOpt(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map(String) : undefined
}
export function boolOpt(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined
}
