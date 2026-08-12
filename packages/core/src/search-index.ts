import {
  blockDocs,
  messageDocs,
  defaultCountTokens,
  type SearchDoc,
  type MessageInput,
  type MessageRole,
  type CompressionState,
  type CoreMessage,
} from "acp-kernel"

function buildMessageOwnerMap(state: CompressionState): Map<string, string> {
  const m = new Map<string, string>()
  for (const b of state.blocks) {
    for (const id of b.effectiveMessageIds) {
      if (!m.has(id)) m.set(id, b.blockId)
    }
  }
  return m
}

/** Unlike the kernel's `coveredMessageIds` (active blocks only), the search
 *  index wants to keep inactive/nested-tier message originals individually
 *  reachable — so a search hit can point straight at the owning block to
 *  decompress. Therefore we walk ALL blocks here, not just active ones. */
function buildSearchCoveredRefs(state: CompressionState): Set<string> {
  const s = new Set<string>()
  for (const b of state.blocks) for (const id of b.effectiveMessageIds) s.add(id)
  return s
}

function toRole(cm: CoreMessage): MessageRole | null {
  if (cm.role === "user") return "user"
  if (cm.role === "assistant") return "assistant"
  if (cm.role === "tool") return "tool"
  return null
}

export function buildSearchDocs(state: CompressionState, cores: CoreMessage[]): SearchDoc[] {
  const covered = buildSearchCoveredRefs(state)
  const ownerMap = buildMessageOwnerMap(state)
  const blockTier = new Map<string, number>()
  for (const b of state.blocks) blockTier.set(b.blockId, b.tier ?? 1)

  const msgs: MessageInput[] = []
  for (const cm of cores) {
    if (!cm.id) continue
    const role = toRole(cm)
    if (!role) continue
    if (!covered.has(cm.id)) continue
    const text = cm.text ?? ""
    if (!text || text.length < 2) continue
    const ownerBlock = ownerMap.get(cm.id)
    msgs.push({
      ref: cm.id,
      role,
      text,
      tokens: defaultCountTokens(text),
      blockId: ownerBlock,
      tier: ownerBlock ? blockTier.get(ownerBlock) : undefined,
    })
  }

  return [...blockDocs(state), ...messageDocs(msgs)]
}
