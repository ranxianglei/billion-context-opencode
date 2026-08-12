import { defaultCountTokens, coveredMessageIds, type CompressionState, type CoreMessage } from "acp-kernel"

/** Re-export the kernel's own definition so this adapter stays in lockstep if
 *  the kernel ever changes what "covered" means (e.g. adds directBlockIds
 *  traversal). Previously this was hand-rolled, which would silently diverge. */
export { coveredMessageIds as collectCoveredMessageIds }

/** Tool names whose call/result output should be excluded from token counts
 *  — the compress tool's own output is transient bookkeeping, not real
 *  context. Only the bili_ prefixed name is matched; a bare "compress" would
 *  risk silently zeroing out an unrelated user tool (e.g. an image-compress
 *  tool), skewing the token estimate that drives nudge decisions. */
const COMPRESS_TOOL_NAMES = new Set(["bili_compress"])

export function estimateTokens(messages: CoreMessage[], coveredIds?: Set<string>): number {
  let tokens = 0
  for (const m of messages) {
    if (m.toolName && COMPRESS_TOOL_NAMES.has(m.toolName)) continue
    if (coveredIds?.has(m.id)) continue
    tokens += defaultCountTokens(m.text ?? "")
  }
  return tokens
}
