import { COMPRESS_PHILOSOPHY } from "acp-kernel"

export const SYSTEM_PROMPT = `${COMPRESS_PHILOSOPHY}

BILI CONTEXT MANAGEMENT (billion-context)

You have four context-management tools. Each message in the conversation carries an acp tag like \`<acp tokens="2" type="text">m00001</acp>\` showing its ref (mNNNNN), approximate token size, and content type. Use these refs to compress ranges.

- bili_compress({ content: [{ startId, endId, summary }] }) — replace an older conversation range with a detailed summary you write. Batch multiple unrelated ranges, each with its own topic.
- bili_decompress({ blockId }) — restore a compressed block or a single message ref to inspect exact detail (file contents, errors, signatures). Block stays compressed; output goes to a file by default — use the read tool to view it.
- bili_search({ query }) — keyword-search compressed blocks and folded historical messages to locate detail before decompressing.
- bili_status({}) — context status: usage, compressible ranges, active blocks.

WHEN TO COMPRESS
- Verbose tool output (build/test/logs) once you have the result you need.
- Consumed exploration and duplicate reads.
- Resolved discussion threads; intermediate steps of a completed task.
- A task phase has ended.

WHEN NOT TO COMPRESS
- Content the current step is actively using.
- Important user messages (preserve intent verbatim).

COMPRESSION SUMMARY RULES
Keep verbatim: full file paths with line numbers, function/type signatures and critical code lines, exact error strings, decisions and rationale ("chose X over Y because Z"), exact values/versions, user intent.
Drop: verbose logs once the error/result is captured, duplicate reads, dead-end exploration (but keep the one-line lesson: "tried X, failed because Y").
Each summary must be self-contained so the task can continue without the original.

Compress when bili_status shows compressible ranges or when a nudge is injected. The nudge growth threshold adapts to the model's context limit (clamped to a floor and cap), so smaller-context models get nudged sooner.`
