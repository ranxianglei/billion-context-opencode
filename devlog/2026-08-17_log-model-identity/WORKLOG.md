# WORKLOG

- 2026-08-17: Added `model: event.model ? providerID/id : null` to the `transform-in` debug line in `runPipelineV2` (packages/billion-context-opencode/src/index.ts). V1 path untouched (no model ref in that scope; the V1 line already lacks per-model resolution). tsc clean, 54/54.
