import { writeFile, mkdir } from "node:fs/promises"
import { resolve, relative, isAbsolute, join } from "node:path"
import { tmpdir, homedir } from "node:os"
import { randomUUID } from "node:crypto"
import { parseBlockIdArg, collectBlockContent } from "acp-kernel"
import type { AcpRuntime } from "./runtime.js"
import type { V2ToolInfo, V2ToolContext } from "./compress-tool.js"
import { debug } from "./log.js"

const AUTO_DIR = join(homedir() || tmpdir(), ".cache", "opencode-bili-acp", "decompress")
const PREVIEW_CHARS = 600
const MESSAGE_INLINE_THRESHOLD = 2000

const ALLOWED_DIRS = [
  tmpdir(),
  join(homedir(), ".cache", "opencode"),
  join(homedir(), ".cache", "opencode-bili-acp"),
]

function resolveToFilePath(targetPath: string): string | { error: string } {
  const expanded = targetPath.startsWith("~/") ? join(homedir(), targetPath.slice(2)) : targetPath
  const resolved = resolve(expanded)
  const isAllowed = ALLOWED_DIRS.some((dir) => {
    const rel = relative(dir, resolved)
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
  })
  if (!isAllowed) {
    return { error: `Error: toFile path must be under ${tmpdir()}, ~/.cache/opencode, or ~/.cache/opencode-bili-acp. Got: ${targetPath}` }
  }
  return resolved
}

function autoFilePath(blockId: string): string {
  return join(AUTO_DIR, `${blockId}-${Date.now()}-${randomUUID().slice(0, 8)}.txt`)
}

function headPreview(text: string): string {
  if (text.length <= PREVIEW_CHARS) return text
  return text.slice(0, PREVIEW_CHARS) + "\n\n... (truncated; use read tool for full content)"
}

function findMessageContent(ref: string, cores: { id: string; text?: string; role: string }[]): { text: string; role: string } | null {
  for (const cm of cores) {
    if (cm.id === ref) return { text: cm.text ?? "", role: cm.role }
  }
  return null
}

export function makeDecompressTool(runtime: AcpRuntime): V2ToolInfo {
  return {
    name: "bili_decompress",
    description:
      'Restore a previously compressed block, or a single message by its ref. The block/message stays compressed — context is not disrupted. BLOCK decompress (blockId "b5") defaults to writing a file; use inline:true to return inline. MESSAGE decompress (blockId = a message ref from bili_search results) returns that ONE message original text, default inline. full:true recurses through nested tiers (block mode only).',
    input: {
      type: "object",
      properties: {
        blockId: { type: "string", description: 'Block id to restore, e.g. "b5". Also accepts a message ref from bili_search results — resolves to the owning block automatically.' },
        full: { type: "boolean", description: "Recurse through all nested blocks to original messages. Default: false (one tier up)." },
        toFile: { type: "string", description: "Write restored content to this path (must be under /tmp, ~/.cache/opencode, or ~/.cache/opencode-bili-acp)." },
        inline: { type: "boolean", description: "Return content inline as this tool result. Default: false for blocks (file), true for single messages." },
      },
    },
    async execute(args, ctx) {
      return runtime.acquireLock(ctx.sessionID, () => handleDecompress(args, runtime, ctx))
    },
  }
}

async function handleDecompress(args: Record<string, unknown>, runtime: AcpRuntime, ctx: V2ToolContext): Promise<{ content: string }> {
  const state = await runtime.stateFor(ctx.sessionID)
  const cores = runtime.getCores(ctx.sessionID) ?? []
  const arg = String(args.blockId ?? "").trim()
  if (!arg) return { content: "Error: blockId is required." }

  const owner = state.blocks.find((b) => b.effectiveMessageIds.includes(arg))
  if (owner) return { content: await handleMessageRef(arg, owner.blockId, args, cores) }

  const blockId = parseBlockIdArg(arg)
  if (!blockId) return { content: `Invalid blockId: ${args.blockId as string}. Expected format like "b5", "5", or a message ref from bili_search results.` }
  const block = state.blocks.find((b) => b.blockId === blockId)
  if (!block) {
    const active = state.blocks.filter((b) => b.active).map((b) => b.blockId).join(", ")
    return { content: `Block ${blockId} not found. Active blocks: ${active || "(none)"}.` }
  }

  const full = args.full === true
  const { text, count } = collectBlockContent(state, block, cores, { full })
  if (count === 0) return { content: `Block ${blockId} has no restorable message content.` }

  if (args.inline === true && args.toFile === undefined) {
    debug("decompress", { blockId, full, count, mode: "inline" })
    return { content: `Restored block ${blockId} (${count} item${count === 1 ? "" : "s"}) inline:\n\n${text}` }
  }

  const targetPath = args.toFile !== undefined ? resolveToFilePath(String(args.toFile)) : autoFilePath(blockId)
  if (typeof targetPath === "object" && "error" in targetPath) return { content: targetPath.error }

  await mkdir(AUTO_DIR, { recursive: true }).catch(() => {})
  await writeFile(targetPath, text, "utf8")
  debug("decompress", { blockId, full, count, mode: "file", path: targetPath, chars: text.length })

  const itemWord = count === 1 ? "item" : "items"
  return {
    content: [
      `Block ${blockId} (${count} ${itemWord}, ${text.length} chars) written to ${targetPath}.`,
      "Block stays compressed — context unchanged. Use the read tool to access the content.",
      "",
      "Preview:",
      headPreview(text),
    ].join("\n"),
  }
}

async function handleMessageRef(ref: string, ownerBlockId: string, args: Record<string, unknown>, cores: { id: string; text?: string; role: string }[]): Promise<string> {
  const found = findMessageContent(ref, cores)
  if (!found || !found.text) {
    return `Message ${ref} (in block ${ownerBlockId}) has no restorable text content.`
  }
  const { text, role } = found
  const wantFile = args.toFile !== undefined || args.inline === false || text.length >= MESSAGE_INLINE_THRESHOLD

  if (!wantFile) {
    debug("decompress-message", { ref, ownerBlockId, mode: "inline", chars: text.length })
    return `Message ${ref} (${role}, block ${ownerBlockId}, ${text.length} chars) restored inline:\n\n${text}`
  }

  const targetPath = args.toFile !== undefined ? resolveToFilePath(String(args.toFile)) : autoFilePath(`msg-${ref}`)
  if (typeof targetPath === "object" && "error" in targetPath) return targetPath.error

  await mkdir(AUTO_DIR, { recursive: true }).catch(() => {})
  await writeFile(targetPath, text, "utf8")
  debug("decompress-message", { ref, ownerBlockId, mode: "file", chars: text.length })

  return [
    `Message ${ref} (${role}, block ${ownerBlockId}, ${text.length} chars) written to ${targetPath}.`,
    "Block stays compressed — context unchanged. Use the read tool to access the content.",
    "",
    "Preview:",
    headPreview(text),
  ].join("\n")
}
