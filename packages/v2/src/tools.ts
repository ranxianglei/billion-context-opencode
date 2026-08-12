import {
  makeCompressTool,
  makeDecompressTool,
  makeSearchTool,
  makeStatusTool,
  type AcpRuntime,
  type ToolContext,
  type ToolDef,
} from "@bili/core"

/** opencode2 tool-execution context (structural subset of @opencode-ai/plugin's
 *  ToolContext). `id` is the tool-call id; V1's `callID` maps onto it. */
export interface V2ToolContext {
  sessionID: string
  agent?: string
  messageID?: string
  id?: string
  progress?: (update: unknown) => Promise<void>
}

/** opencode2 tool shape: `Info` = { name, description, input (schema), execute }. */
export interface V2ToolInfo {
  name: string
  description: string
  input: Record<string, unknown>
  execute(input: Record<string, unknown>, ctx: V2ToolContext): Promise<{ content: string }>
}

/** opencode2 does not provide directory/worktree; V1 ToolContext requires them. */
function toV1Context(ctx: V2ToolContext): ToolContext {
  return {
    sessionID: ctx.sessionID,
    messageID: ctx.messageID ?? "",
    callID: ctx.id,
    agent: ctx.agent ?? "",
    directory: "",
    worktree: "",
  }
}

async function run(tool: ToolDef, input: Record<string, unknown>, ctx: V2ToolContext): Promise<{ content: string }> {
  const result = await tool.execute(input, toV1Context(ctx))
  return { content: typeof result === "string" ? result : result.output }
}

export function makeV2CompressTool(runtime: AcpRuntime): V2ToolInfo {
  const tool = makeCompressTool(runtime)
  return {
    name: "bili_compress",
    description: tool.description,
    input: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Fallback topic for entries without their own." },
        content: {
          type: "array",
          description: "One or more ranges to compress, each with start/end boundaries and a summary.",
          items: {
            type: "object",
            properties: {
              startId: { type: "string", description: 'Message ref, e.g. "m00005" (from the bili tag), or a block id "b3".' },
              endId: { type: "string", description: "Inclusive end ref. Must be at or after startId." },
              summary: { type: "string", description: "Complete technical summary replacing all content in range. Keep only essential details (conclusions, file paths, signatures, decisions, exact values)." },
              topic: { type: "string", description: "Short label (3-5 words) for THIS range. Omit to use top-level topic." },
            },
            required: ["startId", "endId", "summary"],
          },
        },
        summaryMaxChars: { type: "number", description: "Override max summary length (default 20000). Use when content needs more detail." },
      },
      required: ["content"],
    },
    execute(input, ctx) {
      return run(tool, input, ctx)
    },
  }
}

export function makeV2DecompressTool(runtime: AcpRuntime): V2ToolInfo {
  const tool = makeDecompressTool(runtime)
  return {
    name: "bili_decompress",
    description: tool.description,
    input: {
      type: "object",
      properties: {
        blockId: { type: "string", description: 'Block id to restore, e.g. "b5". Also accepts a message ref from bili_search results — resolves to the owning block automatically.' },
        full: { type: "boolean", description: "Recurse through all nested blocks to original messages. Default: false (one tier up)." },
        toFile: { type: "string", description: "Write restored content to this path (must be under /tmp, ~/.cache/opencode, or ~/.cache/opencode-bili-acp)." },
        inline: { type: "boolean", description: "Return content inline as this tool result. Default: false for blocks (file), true for single messages." },
      },
      required: ["blockId"],
    },
    execute(input, ctx) {
      return run(tool, input, ctx)
    },
  }
}

export function makeV2SearchTool(runtime: AcpRuntime): V2ToolInfo {
  const tool = makeSearchTool(runtime)
  return {
    name: "bili_search",
    description: tool.description,
    input: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords to locate detail folded into compressed summaries or historical messages." },
        limit: { type: "number", description: "Max results (default 10)." },
      },
      required: ["query"],
    },
    execute(input, ctx) {
      return run(tool, input, ctx)
    },
  }
}

export function makeV2StatusTool(runtime: AcpRuntime): V2ToolInfo {
  const tool = makeStatusTool(runtime)
  return {
    name: "bili_status",
    description: tool.description,
    input: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["compressed", "uncompressed"], description: '"compressed" = drill into blocks; "uncompressed" = show visible messages/ranges. Default: overview.' },
        view: { type: "string", enum: ["ranges", "messages"], description: 'For uncompressed scope: "ranges" (default) or "messages".' },
        tool: { type: "string", description: 'Filter by tool name (e.g. "bash", "read"). uncompressed+messages only.' },
        sort: { type: "string", enum: ["size", "time", "tool", "age"], description: "Sort order. Default: size." },
        limit: { type: "number", description: "Max items to show (default 30)." },
      },
    },
    execute(input, ctx) {
      return run(tool, input, ctx)
    },
  }
}
