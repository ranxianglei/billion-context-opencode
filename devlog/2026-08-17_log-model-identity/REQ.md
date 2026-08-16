# REQ — log: model identity on transform lines

## Background

Analyzing a user log (omp issue #47 family, 2026-08-17): the compress-rejection loop could not be attributed to a model from the log alone — required environment forensics. All sibling adapters (omp #78, pi #156, proxy #164) are adding model identity in the same sweep.

## Requirements

- R1: The per-turn debug line (`transform-in`) must carry the model identity when the host provides it (`event.model`).
- R2: Format: `providerID/model.id` (matches the plugin's own model-limit resolution key). `null` when absent (V1 path has no model ref in scope).
- R3: Debug-only (existing `debug()` gate), no behavior change, no new dependency.

## Acceptance

- AC1: `transform-in` debug line includes `model` field on the V2 context path.
- AC2: typecheck clean; full suite green (54/54).
