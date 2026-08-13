# billion-context-opencode Development Specification

> **This document is the highest-priority specification for this project. All developers (including AI Agents) MUST comply unconditionally.**

---

## 1. Project Overview

### 1.1 What Is billion-context-opencode

**billion-context-opencode** is an [opencode](https://opencode.ai) plugin that wires the [acp-kernel](https://github.com/ranxianglei/acp-kernel) compression engine into opencode, enabling **model-driven context management**: the model itself decides when and what to compress into high-fidelity summaries, via four `bili_`-prefixed tools (`bili_compress`, `bili_decompress`, `bili_search`, `bili_status`).

The distinguishing feature of this package is its **dual-shape entry**: a single default export loads on **both opencode V1** (callable plugin factory) and **opencode V2** (`.id` + `.setup(ctx)`). See [§2.3](#23-the-dual-shape-mechanism-key-insight) for how this works.

The package depends on `acp-kernel@0.0.19` and a private workspace `@bili/core` (framework-agnostic glue). It is an independent implementation — it does **not** depend on or conflict with `opencode-acp`.

### 1.2 Tech Stack

| Category           | Technology                                                         |
| ------------------ | ----------------------------------------------------------------- |
| Language           | TypeScript (strict, `noUncheckedIndexedAccess`, ESM)              |
| Runtime            | Node.js (CI matrix: 22, 24)                                        |
| Build              | `tsup` (single ESM bundle, kernel + zod + `@bili/core` inlined)   |
| Test Runner        | Node.js built-in: `node --import tsx --test tests/*.test.ts`      |
| Package Manager    | npm (workspaces monorepo)                                         |
| Validation         | `zod`                                                             |
| Compression engine | `acp-kernel` (consumed unmodified via public API)                 |

### 1.3 Repository Info

| Field            | Value                                                        |
| ---------------- | ----------------------------------------------------------- |
| npm package      | `billion-context-opencode` (the **only** published package) |
| Current version  | `0.1.0`                                                      |
| GitHub           | https://github.com/ranxianglei/billion-context-opencode      |
| License          | MIT                                                          |
| Default branch   | `master`                                                     |

---

## 2. Architecture

### 2.1 Module Map

```
billion-context-opencode/   (npm-workspaces monorepo)
├── packages/
│   ├── core/                           @bili/core — PRIVATE workspace, framework-agnostic glue
│   │   ├── package.json                name "@bili/core", private, main ./src/index.ts (consumed as raw TS)
│   │   └── src/
│   │       ├── index.ts                barrel export
│   │       ├── runtime.ts              AcpRuntime: per-session state, per-session async lock, cores/model-limit/turn/config caches, LRU eviction (MAX_SESSIONS_IN_MEMORY=32)
│   │       ├── state.ts                SessionStateStore: load/save CompressionState to ~/.cache/opencode-bili-acp/<sid>.acp.json
│   │       ├── config.ts               resolveConfig: AdapterConfig → kernel defaultConfig (defers nudge thresholds to kernel); FALLBACK_LIMIT=200000
│   │       ├── options.ts              numOpt / strArrayOpt / boolOpt — option coercion helpers
│   │       ├── tokens.ts               estimateTokens, collectCoveredMessageIds
│   │       ├── search-index.ts         buildSearchDocs (compressed blocks + covered messages)
│   │       ├── compress-tool.ts        makeCompressTool (bili_compress); ToolDef / ToolContext types
│   │       ├── decompress-tool.ts      makeDecompressTool (bili_decompress)
│   │       ├── search-tool.ts          makeSearchTool (bili_search)
│   │       ├── status-tool.ts          makeStatusTool (bili_status)
│   │       ├── system-prompt.ts        SYSTEM_PROMPT — compression philosophy + tool guide
│   │       └── log.ts                  debug / warn logging (BILI_ACP_DEBUG=1)
│   │
│   └── billion-context-opencode/       the ONE published package
│       ├── package.json                name "billion-context-opencode", version 0.1.0, MIT, main ./dist/index.js, deps acp-kernel@0.0.19
│       ├── src/
│       │   ├── index.ts                dual-shape entry (see §2.3): V1 plugin factory + V2 setup
│       │   ├── messages-v1.ts          V1 opencode msgs ↔ kernel CoreMessage[] (OctoMessage shape)
│       │   └── messages-v2.ts          V2 opencode msgs ↔ kernel CoreMessage[] (V2Message shape)
│       ├── tests/                      config.test.ts, messages.test.ts, state.test.ts
│       ├── tsconfig.json               extends ../../tsconfig.base.json
│       └── tsup.config.ts              bundles acp-kernel + zod + @bili/core inline (noExternal)
│
├── tsconfig.base.json                  shared: strict, noUncheckedIndexedAccess, ES2022, bundler moduleResolution
├── package.json                        monorepo root: private, workspaces ["packages/*"]
├── README.md
└── smoke.mjs                           end-to-end check against dist/
```

**Why a monorepo?** `@bili/core` holds all host-agnostic logic (runtime, config, state, tokens, the four tools, the system prompt). `packages/billion-context-opencode` is a thin host adapter that only knows how to convert opencode's message shapes (V1 `OctoMessage` and V2 `V2Message`) into the kernel's `CoreMessage[]` and reassemble results. This keeps the kernel-facing logic shared and testable, and lets the host adapter stay small.

### 2.2 Core Data Flow

```
opencode  (V1 transform hooks  OR  V2 "context" session hook)
    │
    ├─ V1 path — biliAcpPluginV1(input, options) returns OctoHooks:
    │     • experimental.chat.system.transform  → setModelLimit + push SYSTEM_PROMPT
    │     • experimental.chat.messages.transform → runPipelineV1(output.messages)
    │
    └─ V2 path — setupV2(ctx):
          • ctx.tool.transform(...)   → add the 4 bili_ tools
          • ctx.session.hook("context", event) → runPipelineV2(event.messages)
          • ctx.catalog.model.list() → resolve model context limit
    │
    ▼
messages-v1.ts / messages-v2.ts   octoToCoreMessages / v2ToCoreMessages → CoreMessage[]
    │
    ▼
AcpRuntime  (per session; all work serialized via acquireLock)
    ├─ stateFor(sid)          load CompressionState from disk
    ├─ collectCoveredMessageIds + estimateTokens
    ├─ core.processTurn({messages, state, config, tokenCount, renderTags:"text-only"})
    │        kernel decides: prune compressed ranges, inject nudges, assign mNNNNN refs
    ├─ setCores / cacheTurn / save(state)
    └─ reassemble (v1 or v2)   → splice rebuilt messages in place on the host array
    │
    ▼
bili_compress / bili_decompress / bili_search / bili_status   (registered tools)
    └─ each calls AcpRuntime under the per-session lock, then persists state
```

Both V1 and V2 feed the **same** `AcpRuntime` + kernel pipeline; they differ only in message shape conversion (`messages-v1.ts` vs `messages-v2.ts`) and how system prompt / model limit / tools are registered.

### 2.3 The Dual-Shape Mechanism (Key Insight)

The package's entire reason for existing as one entry is this export (`packages/billion-context-opencode/src/index.ts`):

```typescript
export default Object.assign(biliAcpPluginV1, {
  id: "billion-context-opencode",
  setup: setupV2,
})
```

**Why this works on both opencode major versions:**

1. **`Object.assign(target, source)` returns `target`** — the *same* function object — with `source`'s enumerable own properties (`id`, `setup`) copied onto it. So the result is still `biliAcpPluginV1` (still callable), now carrying `.id` and `.setup`.
2. **opencode V1 loader** sees a function and calls it as `biliAcpPluginV1(input, options)`, which returns an `OctoHooks` object (the V1 transform hooks + `tool` map). The extra `.id`/`.setup` properties are simply ignored.
3. **opencode V2 loader** reads `.id` and calls `.setup(ctx)`. It never *calls* the function itself, so the function body (the V1 factory) never runs in V2. The crucial enabler: **`Plugin.define` in the V2 SDK (`@opencode-ai/plugin`) is an IDENTITY function** — `function define(plugin){ return plugin }` — with **no branding Symbol, no runtime validation**. V2 therefore accepts *any* object with `{ id, setup }`. Because JS functions are objects, a callable that also carries `{ id, setup }` satisfies both loaders simultaneously.

**Load-bearing consequence:** the package deliberately does **NOT** import `@opencode-ai/plugin`. `setupV2`'s parameter is a structural `PluginSetupContext` type defined inline in `index.ts`. This keeps the built `dist/index.js` free of the SDK at runtime (zero package-resolution conflicts between V1 and V2 environments) while remaining type-safe at compile time.

> **Do not refactor the dual-shape export into two separate entries** without a migration plan. It is the load-bearing mechanism that makes one package serve both opencode versions. Any change here MUST add a devlog `DESIGN.md`.

### 2.4 Message Conversion (V1 vs V2)

| Concern | V1 (`messages-v1.ts`) | V2 (`messages-v2.ts`) |
| --- | --- | --- |
| Host message shape | `OctoMessage { info, parts[] }` | `V2Message { id?, role, content[] }` |
| Conversion | `octoToCoreMessages` → `{cores, partIdToCoreIds}` | `v2ToCoreMessages` → `{cores, origin, partToCoreIds}` |
| Session id | `deriveSessionId(msgs)` (scan for first non-empty `info.sessionID`) | `event.sessionID` (provided by the hook) |
| Model limit | `system.transform` → `input.model.limit.context` | `ctx.catalog.model.list()` lookup by `{providerID,id}` |
| Reassembly | `reassemble` — tool part kept only if call **and** result both survive | `reassemble` — same call+result pairing rule; media-only msgs preserved in place |
| Nudge message | `makeNudgeMessage` (synthetic `OctoMessage`, role `user`) | `makeNudgeMessage` (`V2Message`, role `user`) |

Both converters enforce a **call↔result pairing invariant**: a tool-call is emitted only when its matching tool-result also survived the kernel's pruning, and vice versa. Dropping one half would produce malformed provider history. Preserve this invariant in any change.

### 2.5 Configuration

Plugin options (declared as `AdapterConfig` in `packages/core/src/config.ts`):

| Option | Default | Description |
| --- | --- | --- |
| `modelContextLimit` | auto (model limit, else `200000`) | Token limit for nudge math. Env `BILI_MODEL_CONTEXT_LIMIT` overrides. |
| `preserveRecentMessages` | `5` | Recent messages always kept visible. |
| `protectedTools` | `[]` | Tool-result message ids never compressed. |
| `debug` | `false` | Verbose logging. Env `BILI_ACP_DEBUG=1` also enables. |
| `coreOverrides` | `{}` | Raw `acp-kernel` config overrides (advanced; nudge thresholds default to the kernel's own adaptive values). |

`resolveConfig` **defers all nudge/threshold math to the kernel's `defaultConfig`** (which scales growth floor/cap from `modelContextLimit`). Do not re-implement thresholds in the adapter.

### 2.6 Storage Paths

| What | Path | Notes |
| --- | --- | --- |
| Per-session state | `~/.cache/opencode-bili-acp/<sid>.acp.json` | `SessionStateStore` (disk JSON) |
| Built artifact | `packages/billion-context-opencode/dist/index.js` | self-contained, zero runtime deps |

### 2.7 Bundling

`tsup` (`packages/billion-context-opencode/tsup.config.ts`) marks `acp-kernel`, `zod`, `zod/v4`, and `@bili/core` as **`noExternal`** — they are bundled inline. The published `dist/index.js` is self-contained with **zero runtime dependencies**. This is intentional: it avoids version-resolution conflicts inside opencode's plugin sandbox. Do not add runtime `dependencies` to the published package without strong justification.

---

## 3. Development Standards

### 3.1 Build Commands

All commands run from the repo root unless noted.

```bash
npm install              # install workspaces (run once / after dependency changes)
npm run build            # = npm run build --workspace billion-context-opencode (tsup bundle)
npm run typecheck        # = npm run typecheck --workspaces
npm run test             # = npm run test --workspace billion-context-opencode (node --import tsx --test tests/*.test.ts)
node smoke.mjs           # end-to-end check against dist/ (run after build)
```

Per-package (run from inside a package dir):

```bash
npm run typecheck        # tsc --noEmit for that package
npm test                 # tests/*.test.ts (billion-context-opencode only; @bili/core has no tests)
npm run build            # tsup (billion-context-opencode only)
```

### 3.2 Build Output

- `packages/billion-context-opencode/dist/index.js` — bundled ESM (the published artifact)
- `packages/billion-context-opencode/dist/index.js.map` — sourcemap
- Published files (per `main` + npm defaults): `dist/`, `README.md`, `LICENSE`
- `@bili/core` is **never published** (`"private": true`, `"version": "0.0.0"`); it is consumed as raw TS via the workspace at build time and inlined into the bundle.

### 3.3 Testing

**Test runner:** `node --import tsx --test tests/*.test.ts`

**Test location:** `packages/billion-context-opencode/tests/` (flat). Current files: `config.test.ts`, `messages.test.ts`, `state.test.ts`.

CI (`ci.yml`) runs `typecheck` + `build` + `test` on Node 22 and 24.

### 3.4 Local Deployment / Smoke

```bash
npm run build && node smoke.mjs     # verify the bundle loads and tools register
```

For a clean opencode instance loading only this plugin, see the `test-clean/` harness and `README.md` "Clean test environment".

### 3.5 npm Publishing

**Only** `billion-context-opencode` is published (it is the only public package). `@bili/core` is private and must never be published.

```bash
# Build + verify locally
npm run build
node smoke.mjs

# Publish ONLY the public package
npm publish --workspace billion-context-opencode
```

**Releases are automated via CI** — see [§5.4](#54-release-workflow-automated-via-ci). Manual publish is a fallback only.

---

## 4. Code Change Guidelines

### 4.1 Module Dependencies

```
packages/core (no host knowledge — leaf)
    ↑ consumed via workspace
packages/billion-context-opencode/src/index.ts  (host adapter: V1 + V2)
    ├─ messages-v1.ts   (V1 shape conversion)
    ├─ messages-v2.ts   (V2 shape conversion)
    └─ @bili/core        (runtime, config, state, tools, system prompt)
            └─ acp-kernel (the compression engine, consumed unmodified)
```

**Rules:**

- `@bili/core` knows **nothing** about opencode (no V1/V2 types). It is host-agnostic.
- The host adapter (`packages/billion-context-opencode`) knows opencode shapes (V1/V2) and `@bili/core`'s public API — nothing else.
- `acp-kernel` is used **unmodified** via its public API. Do not fork or patch it.

### 4.2 Common Patterns

- **Per-session lock**: `AcpRuntime.acquireLock(sessionId, fn)` serializes all async work for a session. All transform hooks and all `bili_` tools MUST run inside it — concurrent compress writes to the same session file corrupt state. Callers MUST `.catch()` the returned promise.
- **State identity for cache freshness**: `AcpRuntime` caches a `processTurn` result and invalidates it by **reference equality** of the `state`/`cores` objects. A compress writes a new state object, so the cache auto-stales. Preserve this contract.
- **Splice-in-place reassembly**: both V1 and V2 rebuild the host's message array **in place** (`msgs.splice(0, msgs.length, ...reassembled)`). opencode passes the same array reference; do not return a new array.
- **Structural types over SDK imports**: the package avoids importing `@opencode-ai/plugin` at runtime (see [§2.3](#23-the-dual-shape-mechanism-key-insight)). Keep host types as inline structural interfaces.

---

## 5. Contributing

### 5.1 Before Making Changes

1. `npm run typecheck` passes (run from root — it covers all workspaces).
2. Understand the module dependency graph ([§4.1](#41-module-dependencies)).
3. Check whether the change touches the **dual-shape export** ([§2.3](#23-the-dual-shape-mechanism-key-insight)) or the **call↔result pairing invariant** ([§2.4](#24-message-conversion-v1-vs-v2)) — these are load-bearing and require extra care.

### 5.1.1 Development Workflow

All changes MUST follow this workflow:

1. Create a feature branch from `master` (naming: `YYYY-MM-DD_short-title`).
2. Create a devlog entry: `devlog/{YYYY-MM-DD_short-title}/` with `REQ.md` (see [§5.1.2](#512-devlog-requirement-mandatory)).
3. Implement changes (source lives under `packages/`; standards/CI/docs live at the repo root).
4. Ensure `npm run typecheck` and `npm run build` pass.
5. Ensure `npm run test` passes.
6. Commit with descriptive messages (include devlog files).
7. Push branch and create a GitHub PR targeting `master`.
8. Obtain **dual-agent review** ([§5.3](#53-code-review-mandatory)) on the PR.
9. **PR merge is a human-only operation** — AI agents MUST NEVER merge PRs, even when explicitly instructed or forced. See [§5.1.1.2](#5112-pr-merge--absolute-prohibition).

### 5.1.1.1 Git Safety Rules (MANDATORY)

| Rule | Enforcement |
| --- | --- |
| **NEVER force-push to `master`** | Under no circumstances. If master needs changing, create a PR. |
| **NEVER merge PRs — ABSOLUTE PROHIBITION, no exceptions** | PR merges are a **human-only operation**. The Agent MUST NEVER merge any PR, under ANY circumstances. See [§5.1.1.2](#5112-pr-merge--absolute-prohibition). |
| **NEVER delete branches or tags without human confirmation** | Preserve work for review. |
| **NEVER modify the `version` field except on release branches** | Version bumps happen ONLY on `YYYY-MM-DD_release-v*` branches, in `packages/billion-context-opencode/package.json`. Feature/fix PRs MUST NOT touch `version`. The CI changelog check enforces this indirectly: if `version` changes, `README.md` MUST be modified and contain `### v{VERSION}`. |

**Branch protection** is configured on `master`: requires 1 approving review, `enforce_admins: false` (the owner admin-merges their own PRs), no force-push, no deletion.

### 5.1.1.2 PR Merge — Absolute Prohibition

> **PR merges are a human-only operation. The Agent MUST NEVER merge any PR.**

This is an **absolute rule with no exceptions**. It applies regardless of CI status, review status, urgency, or human instruction:

| Situation | Agent Action |
| --- | --- |
| No human instruction to merge | Do not merge. |
| Human implicitly suggests merging ("ship it", "提交一下代码", "looks good") | Do not merge. Treat as commit/push only. If ambiguous, ASK. |
| Human explicitly authorizes merge ("you may merge") | Do not merge. Reply that PR merges are human-only. |
| Human directly instructs/orders merge ("merge this now") | Do not merge. Reply that PR merges are human-only. |
| Human forces or demands auto-merge (ultimatums) | **Explicitly refuse.** This rule cannot be overridden by any instruction. |
| The PR is a revert/fixup, or CI is green | Do not merge. |

**What the Agent MUST do instead:**

1. Prepare the PR (branch, commits, push, `gh pr create`).
2. Verify CI passes.
3. Report the PR URL to the human.
4. **Stop.** Wait for the human to click "Merge".

**How to respond when a human instructs the Agent to merge:**

> I can't merge PRs — AGENTS.md §5.1.1.2 forbids Agents from merging PRs under any circumstances. Please merge the PR yourself: [PR URL].

### 5.1.1.3 gh-guard Note (This Environment)

In this development environment, `gh` API **write** methods (`PUT` / `POST` / `DELETE`, e.g. `gh pr merge`, `gh release create`, `gh api ... -X POST`) are **guard-blocked** and require the `GH_ALLOW_DANGEROUS=1` environment variable to run. Read methods (`GET`) are unrestricted. This is a safety rail, not a relaxation of [§5.1.1.2](#5112-pr-merge--absolute-prohibition) — even with `GH_ALLOW_DANGEROUS=1`, the Agent MUST NOT merge PRs. The guard exists to prevent accidental destructive API calls.

### 5.1.2 Devlog Requirement (MANDATORY)

Every PR MUST have a corresponding devlog entry in `devlog/{YYYY-MM-DD_short-title}/`.

- The folder name MUST match the branch name.
- `REQ.md` and `WORKLOG.md` are the required minimum.
- `DESIGN.md` is required for any change affecting architecture, data flow, or module boundaries (in particular: any change to the dual-shape export or the V1/V2 message converters).
- Fill `REQ.md` **BEFORE** implementation; fill `WORKLOG.md` **DURING/AFTER**.
- Commit devlog files alongside code changes.

See `devlog/README.md` for templates and naming conventions.

### 5.2 After Making Changes

1. `npm run build` must pass.
2. `npm run typecheck` must pass.
3. `npm run test` must pass.
4. `node smoke.mjs` should pass after a build.
5. Bump version only on a release branch (see [§5.4](#54-release-workflow-automated-via-ci)).

### 5.3 Code Review (MANDATORY)

All source changes (files under `packages/`) MUST undergo independent review by **at least 2 separate agents** before merge. Review checklist: correctness, backward compatibility (persisted state format, the dual-shape export, the call↔result pairing invariant), performance, type safety (no `as any`, no `@ts-ignore`), state integrity.

### 5.4 Release Workflow (Automated via CI)

Releases are **fully automated through GitHub Actions**. Workflow: create a release PR → a human merges → CI auto-tags, builds, tests, and publishes the single public package.

#### 5.4.1 CI Workflows

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | `push` to master + `pull_request` to master | Matrix (Node 22, 24): `npm ci` → `typecheck` → `build` → `test`. Job named `build` so branch protection can require it. |
| `pr-checks.yml` | `pull_request` to master | Runs `scripts/ci/check-pr.sh` (branch name, devlog presence, changelog-on-version-bump). Job named `pr-validation`. |
| `release.yml` | `push` to master (+ `workflow_dispatch`) | Detects release-branch merge, tags `v{VERSION}`, publishes `billion-context-opencode`, creates GitHub Release. |

**Why one workflow for tag + publish?** GitHub Actions does not allow workflows pushed by `GITHUB_TOKEN` to trigger other workflows. A separate auto-tag workflow would not fire release.yml. The unified `release.yml` does everything in one job.

#### 5.4.2 Release Process (Step-by-Step)

**Step 1 — Create a release branch** from master, named `YYYY-MM-DD_release-v{VERSION}`:

```bash
git checkout master && git pull origin master
git checkout -b YYYY-MM-DD_release-v{VERSION}
```

**Step 2 — Bump version + changelog + devlog:**

- Edit `packages/billion-context-opencode/package.json` → set `version`.
- Edit `README.md` → append a changelog entry under `## Changelog` with a `### v{VERSION}` header.
- Create `devlog/YYYY-MM-DD_release-v{VERSION}/REQ.md` + `WORKLOG.md`.

> **Prereleases**: a version containing `-` (e.g. `0.2.0-dev.1`) publishes to the npm `dev` tag and marks the GitHub Release as a prerelease. A version without `-` publishes to `latest`.

**Step 3 — Verify, commit, push, create PR:**

```bash
bash scripts/ci/check-pr.sh YYYY-MM-DD_release-v{VERSION} origin/master   # must PASS
git add -A && git commit -m "release: v{VERSION} — title"
git push origin YYYY-MM-DD_release-v{VERSION}
gh pr create --title "release: v{VERSION} — title" --body "..."
```

**Step 4 — Merge PR (human-only; Agent MUST NOT merge — see [§5.1.1.2](#5112-pr-merge--absolute-prohibition)).**

Wait for CI (`pr-validation`, `build`) to pass, then a human merges.

**Step 5 — Auto-publish (fully automated):** merging the PR triggers `release.yml`: it detects the release-branch merge, creates `v{VERSION}` tag, runs `npm ci` → `npm run build` → `npm publish --workspace billion-context-opencode`, and creates the GitHub Release. `workflow_dispatch` with `force: true` publishes outside a release-branch merge (manual override).

**Step 6 — Verify:**

```bash
npm view billion-context-opencode version
gh release view v{VERSION} --repo ranxianglei/billion-context-opencode
```

#### 5.4.3 Prerequisites

- **`NPM_TOKEN` secret** set in GitHub repo settings (Settings → Secrets → Actions).
- **Branch protection** on `master` requires the `pr-validation` and `build` checks to pass before merge, plus 1 approving review.
- **Release branch naming** must follow `YYYY-MM-DD_release-v{VERSION}` for auto-tagging.

#### 5.4.4 Manual Publish (Legacy Fallback)

If CI is down or `NPM_TOKEN` is misconfigured:

```bash
git checkout master && git pull origin master
git status --porcelain                      # MUST be empty
npm run build
npm pack --dry-run 2>&1                     # privacy audit
npm publish --workspace billion-context-opencode
npm view billion-context-opencode version
```

Only as a fallback. The automated workflow ([§5.4.2](#542-release-process-step-by-step)) is the standard process.

### 5.5 Commit Convention

Use descriptive commit messages. Examples:

- `feat: wire V2 catalog model-limit resolution`
- `fix: preserve media-only messages in V2 reassembly`
- `release: v0.1.0 — monorepo + dual-shape single package`
- `chore: add project standards (AGENTS.md, CI, devlog)`
