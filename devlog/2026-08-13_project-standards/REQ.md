# REQ - Project standards (AGENTS.md, CI, devlog, e2e skeleton)

- Task ID: `2026-08-13_project-standards`
- Home Repo: `billion-context-opencode`
- Created: 2026-08-13
- Status: Done
- Priority: P1
- Owner: Sisyphus-Junior (delegated)
- References: derived from `opencode-acp` standards (adapted, not copied)

## 1. Background & Problem Statement

- **Context**: `billion-context-opencode` is a new npm-workspaces monorepo
  (`@bili/core` private + `billion-context-opencode` published) with a dual-shape
  entry that loads on opencode V1 and V2. It had source code and a root
  `package.json` but no project standards, no CI, no devlog convention, and no
  PR/release automation.
- **Current behavior (symptom)**: No `AGENTS.md`, no GitHub Actions, no devlog
  templates, no `check-pr.sh`. Contributors have no enforced conventions; releases
  are manual.
- **Expected behavior**: A focused `AGENTS.md` spec, three CI workflows
  (ci/pr-checks/release), devlog templates + README, a PR-validation script, and an
  e2e harness skeleton.
- **Impact**: Establishes the contributing/release process and CI gates from the
  start, before the package is published more widely.

## 3. Constraints & Non-Goals

- **Constraints**:
  - DO NOT switch branches (worktree is on `2026-08-13_project-standards` synced to
    master `e533c65`).
  - DO NOT modify anything under `packages/` (source code) — only top-level
    standards/CI/docs files.
  - License is MIT (not AGPL). Adapt `opencode-acp`'s structure, do NOT copy it
    verbatim; keep AGENTS.md focused (~250–400 lines).
  - Only `billion-context-opencode` is publishable; `@bili/core` is private.
- **Non-Goals**: No source changes, no e2e harness implementation (skeleton only),
  no commit/push/PR (files only — human reviews and commits).

## 4. Acceptance Criteria (must be testable)

- **Deliverables present**:
  - [x] `AGENTS.md` with the required sections (overview, architecture incl.
        dual-shape mechanism, configuration, dev standards, contributing incl.
        PR-merge prohibition, release workflow, git safety rules, gh-guard note).
  - [x] `.github/workflows/{ci,pr-checks,release}.yml`.
  - [x] `devlog/{README,REQ.template,WORKLOG.template,DESIGN.template}.md`.
  - [x] `scripts/ci/check-pr.sh`.
  - [x] `scripts/e2e/{README.md,run-e2e.sh}` skeleton.
  - [x] `README.md` Changelog section appended (existing content preserved).
- **Verification**:
  - [x] `bash scripts/ci/check-pr.sh 2026-08-13_project-standards origin/master` PASSES.
  - [x] `npm run typecheck --workspaces` still passes (no source touched).
  - [x] `bash -n scripts/ci/check-pr.sh` syntax valid.
  - [x] Workflow YAML files parse.
