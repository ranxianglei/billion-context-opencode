# WORKLOG - Project standards (AGENTS.md, CI, devlog, e2e skeleton)

- Task ID: `2026-08-13_project-standards`
- Home Repo: `billion-context-opencode`
- Status: Done
- Updated: 2026-08-13

## 1. Summary

- **What was done**: Added top-level project standards for the monorepo — a focused
  `AGENTS.md` dev spec, three GitHub Actions workflows (ci / pr-checks / release),
  devlog templates + README, a `scripts/ci/check-pr.sh` PR validator, an e2e
  harness skeleton, and a Changelog entry in README.md.
- **Why**: Establish contributing conventions, CI gates, and automated
  release-from-PR-merge before the package is published more widely.
- **Behavior / compatibility changes**: No. No source under `packages/` was touched.
- **Risk level**: Low (standards/docs/CI only).

## 2. Change Log

### Key Files

- `AGENTS.md` — the dev spec (~340 lines, 8 numbered sections). Documents the
  dual-shape mechanism (`Object.assign(biliAcpPluginV1, {id, setup})` + why
  `Plugin.define` being an identity function makes one entry serve opencode V1 and
  V2), the monorepo module map, config options, dev workflow, the **absolute
  PR-merge prohibition**, git safety rules, release workflow, and the gh-guard note.
- `.github/workflows/ci.yml` — matrix Node 22/24, single `build` job running
  typecheck+build+test.
- `.github/workflows/pr-checks.yml` — `pr-validation` job running `check-pr.sh`
  with `${{ github.head_ref }}` / `origin/${{ github.base_ref }}`.
- `.github/workflows/release.yml` — on push to master + `workflow_dispatch`; detects
  release-branch merge, tags `v{VERSION}`, publishes
  `--workspace billion-context-opencode`, creates GitHub Release; prerelease
  (version contains `-`) → npm `dev` tag.
- `devlog/README.md` + `REQ.template.md` + `WORKLOG.template.md` +
  `DESIGN.template.md` — devlog convention (default branch `master`).
- `scripts/ci/check-pr.sh` — branch-name regex, devlog presence, changelog-on-bump
  (version read from `packages/billion-context-opencode/package.json`).
- `scripts/e2e/README.md` + `run-e2e.sh` — e2e harness PLAN (fake-LLM +
  nudge-detection + state-asserting verify), marked "not yet functional".
- `README.md` — appended `## Changelog` with the `### v0.1.0` entry (existing
  content preserved verbatim).

## 3. Design & Implementation Notes

- AGENTS.md adapted from `opencode-acp`'s structure but rewritten for this repo and
  kept ~3.5x smaller. Key insight preserved verbatim in code: the dual-shape export
  relies on `Object.assign` returning the same callable function and on
  `@opencode-ai/plugin`'s `Plugin.define` being a no-op identity.
- `check-pr.sh` differs from the reference only in the version-source path
  (`packages/billion-context-opencode/package.json`) and dropping the
  `README.zh-CN.md` check (this repo has none).
- `release.yml` publishes ONLY the public workspace (`--workspace
  billion-context-opencode`); `@bili/core` is private and never published.

## 4. Testing & Verification

- `bash scripts/ci/check-pr.sh 2026-08-13_project-standards origin/master` → PASS
  (branch matches regex; devlog REQ.md + WORKLOG.md present; version unchanged).
- `npm run typecheck --workspaces` → PASS (no source touched).
- `bash -n scripts/ci/check-pr.sh` → syntax valid.
- Workflow YAML parses (validated with python yaml).

## 5. Risk Assessment & Rollback

- **Risk points**: None functional (standards/CI/docs only).
- **Rollback method**: `git revert` the standards commit.
- **Compatibility notes**: No data-format or config-schema changes.

## 7. Follow-ups

- [ ] Implement the e2e harness described in `scripts/e2e/README.md` and add an
      `e2e` job to `ci.yml`.
- [ ] Configure `NPM_TOKEN` secret in GitHub repo settings before the first release.
