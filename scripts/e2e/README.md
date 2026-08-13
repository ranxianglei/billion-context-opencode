# scripts/e2e/

End-to-end test harness for **billion-context-opencode**.

> ## ⚠️ Scaffold — not yet functional
>
> This directory is a **planned** harness. The `run-e2e.sh` stub exists only so CI
> and local scripts have a stable entrypoint. **Full e2e is deferred.** Nothing here
> runs a real opencode instance yet. Do not wire it into CI as a gating job until the
> harness described below is implemented.

## Planned Design

The goal is a Docker-isolated harness (modeled on the `opencode-acp` e2e philosophy)
that drives a **real opencode** process against a **fake LLM server** and asserts on
the resulting compression/nudge state. Rationale: unit tests cover the message
converters and config; e2e must cover the *integration* — opencode loading the
dual-shape entry, the V1/V2 hooks firing, the model emitting `bili_compress` calls,
and the persisted state on disk.

### Components (to be built)

| Component | Purpose |
|-----------|---------|
| `fake-llm-server.ts` | A tiny HTTP server impersonating an LLM provider. It echoes a scripted assistant turn OR — critically — **detects ACP nudge injection** in the incoming messages and responds with a `bili_compress` tool call. Reports realistic `prompt_tokens` derived from actual input sizes so the plugin sees real token counts for nudge math. |
| `scenarios/*.json` | Declarative scenarios: a scripted message list + a `"respond"` mode (`"static"` \| `"nudge-compress"` \| `"compress-and-continue"`) + expectations. |
| `verify.ts` | After a scenario runs, asserts on state: block count, nudge state fields, covered-message ids, persisted `~/.cache/opencode-bili-acp/<sid>.acp.json`. Checks **nudge state**, not just block count, so baseline/feedback-loop bugs surface. |
| `run-e2e.sh` | Orchestrator: builds the bundle, starts the fake LLM, boots opencode against an isolated `HOME`/`XDG_CONFIG_HOME`, feeds the scenario, runs `verify.ts`. |

### Planned Scenarios

These are deliberately modeled on the gaps that hid production bugs elsewhere, per
the AGENTS.md nudge/growth testing requirements:

1. **Smoke** — a scripted `bili_compress` call produces one block and prunes the range.
2. **Nudge-triggered compression** — context grows past the threshold; the fake LLM
   detects ACP's injected nudge via `detectNudge()` and emits a `bili_compress` call
   in response. Tests the *real* nudge→compress flow, not just scripted compress.
3. **Growth accumulation** — context grows across multiple turns past the nudge
   threshold, exercising the growth-gating logic (all-compress-in-one-turn does not).
4. **Nudge re-fire after compress** — after a compress resets the baseline, new growth
   must trigger a fresh nudge. Catches baseline-corruption feedback loops.
5. **Decompress** — a `bili_decompress` call restores a block's content correctly.

### Why verify nudge STATE, not just block count

Block count alone cannot detect:
- a corrupted `lastPerMessageNudgeTokens` baseline that suppresses all nudges,
- a feedback loop that re-fires every turn,
- growth math that never crosses the threshold.

`verify.ts` MUST assert on the nudge state fields in addition to block count.

## Status

- [x] Directory + README + `run-e2e.sh` stub
- [ ] `fake-llm-server.ts`
- [ ] `scenarios/`
- [ ] `verify.ts`
- [ ] Wired into CI (`ci.yml` e2e job)

When the harness is implemented, add an `e2e` job to `.github/workflows/ci.yml`
(needs `build`) and document the scenario list in AGENTS.md §3.3.
