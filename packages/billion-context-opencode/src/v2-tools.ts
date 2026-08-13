import { z } from "zod"
import {
  makeCompressTool,
  makeDecompressTool,
  makeSearchTool,
  makeStatusTool,
  type AcpRuntime,
  type ToolContext,
  type ToolDef,
} from "@bili/core"

/** Structural subset of opencode V2's ToolContext (see @opencode-ai/plugin).
 *  `id` is the tool-call id; V1's `callID` maps onto it. Deliberately NOT
 *  imported from the SDK so the built artifact stays runtime-dependency-free
 *  (AGENTS.md §2.3 — the dual-shape mechanism). */
export interface V2ToolContext {
  sessionID: string
  agent?: string
  messageID?: string
  id?: string
  progress?: (update: unknown) => Promise<void>
}

/** opencode V2 tool shape (`Info`): { name, description, input, execute }. */
export interface V2ToolInfo {
  name: string
  description: string
  input: Record<string, unknown>
  execute(input: Record<string, unknown>, ctx: V2ToolContext): Promise<{ content: string }>
}

/** opencode V2 does not provide directory/worktree, but the V1 ToolContext
 *  types them as required strings — pass empty defaults (the bili_* tools key
 *  all persistence off sessionID and never read them). */
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

/** Wrap a V1 ToolDef into opencode V2's tool shape. The JSON Schema is derived
 *  from the tool's zod `args` via `z.toJSONSchema()` (zod >= 4) so the V2 schema
 *  cannot drift from the V1 definitions; execute maps the V2 context onto the
 *  V1 ToolContext and unwraps the V1 result (`string | { output, metadata }`)
 *  into V2's `{ content }` envelope. */
function toV2Tool(name: string, tool: ToolDef): V2ToolInfo {
  return {
    name,
    description: tool.description,
    input: z.toJSONSchema(z.object(tool.args)) as Record<string, unknown>,
    async execute(input, ctx) {
      const result = await tool.execute(input, toV1Context(ctx))
      return { content: typeof result === "string" ? result : result.output }
    },
  }
}

export function makeV2CompressTool(runtime: AcpRuntime): V2ToolInfo {
  return toV2Tool("bili_compress", makeCompressTool(runtime))
}

export function makeV2DecompressTool(runtime: AcpRuntime): V2ToolInfo {
  return toV2Tool("bili_decompress", makeDecompressTool(runtime))
}

export function makeV2SearchTool(runtime: AcpRuntime): V2ToolInfo {
  return toV2Tool("bili_search", makeSearchTool(runtime))
}

export function makeV2StatusTool(runtime: AcpRuntime): V2ToolInfo {
  return toV2Tool("bili_status", makeStatusTool(runtime))
}
