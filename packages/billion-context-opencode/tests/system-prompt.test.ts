import { test } from "node:test"
import assert from "node:assert/strict"
import {
  COMPRESS_PHILOSOPHY,
  HOW_TO_COMPRESS_RULES,
  TIER2_DISTILL_RULES,
  TIER3_CONDENSE_RULES,
} from "acp-kernel"
import { SYSTEM_PROMPT } from "@bili/core"

function countOccurrences(text: string, value: string): number {
  if (value.length === 0) return 0
  return text.split(value).length - 1
}

test("SYSTEM_PROMPT embeds each kernel rule constant verbatim exactly once", () => {
  const rules: ReadonlyArray<readonly [string, string]> = [
    ["COMPRESS_PHILOSOPHY", COMPRESS_PHILOSOPHY],
    ["HOW_TO_COMPRESS_RULES", HOW_TO_COMPRESS_RULES],
    ["TIER2_DISTILL_RULES", TIER2_DISTILL_RULES],
    ["TIER3_CONDENSE_RULES", TIER3_CONDENSE_RULES],
  ]
  for (const [name, rule] of rules) {
    assert.equal(countOccurrences(SYSTEM_PROMPT, rule), 1, `${name} appears verbatim exactly once`)
  }
})

test("SYSTEM_PROMPT documents the registered bili tools and supported modes", () => {
  for (const tool of ["bili_compress", "bili_decompress", "bili_search", "bili_status"]) {
    assert.equal(countOccurrences(SYSTEM_PROMPT, `- ${tool} —`), 1, `${tool} has exactly one tool-guide entry`)
  }
  assert.match(SYSTEM_PROMPT, /startId: "b3", endId: "b15"/)
  assert.match(SYSTEM_PROMPT, /inline:true/)
  assert.match(SYSTEM_PROMPT, /full:true/)
  assert.match(SYSTEM_PROMPT, /one historical message by its ref/)
  assert.match(SYSTEM_PROMPT, /Single-message decompression defaults to inline when small/)
  assert.match(SYSTEM_PROMPT, /long messages and inline:false write to a file/)
  assert.match(SYSTEM_PROMPT, /blockId: "m00175"/)
  assert.match(SYSTEM_PROMPT, /scope:"uncompressed"/)
  assert.match(SYSTEM_PROMPT, /view:"messages"/)
  assert.match(SYSTEM_PROMPT, /scope:"compressed"/)
})

test("SYSTEM_PROMPT keeps adapter-authored tag and threshold guidance host-neutral", () => {
  assert.match(SYSTEM_PROMPT, /When an .*<acp .* tag appears on a visible message/)
  assert.doesNotMatch(SYSTEM_PROMPT, /Each user and tool message carries/)
  assert.doesNotMatch(SYSTEM_PROMPT, /Assistant messages are untagged/)
  assert.doesNotMatch(SYSTEM_PROMPT, /nudge growth threshold/i)
  assert.doesNotMatch(SYSTEM_PROMPT, /smaller-context models get nudged sooner/i)
  assert.match(SYSTEM_PROMPT, /hard-excluded from compression ranges and remain visible in context/)
  assert.match(SYSTEM_PROMPT, /Emergency context truncation may still shorten their bodies/)
  assert.doesNotMatch(SYSTEM_PROMPT, /protected tool outputs[^\n]*survive intact/i)
})

test("SYSTEM_PROMPT preserves the kernel's generic compress name without adaptation", () => {
  assert.ok(SYSTEM_PROMPT.includes("When you call `compress`,"))
  assert.ok(!SYSTEM_PROMPT.includes("When you call `bili_compress`,"))
})
