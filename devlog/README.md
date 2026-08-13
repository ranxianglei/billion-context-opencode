# devlog/

Development iteration tracking for **billion-context-opencode**.

## Purpose

Every development iteration (bug fix, feature, refactor, infra) gets its own folder here. The devlog is a persistent, searchable record of what was done, why, and what was learned — complementing git history with structured context.

## Naming Convention

Folder name: `YYYY-MM-DD_short-title`

- Must match the branch name (e.g., branch `2026-08-13_project-standards` → folder `2026-08-13_project-standards/`).
- Use lowercase, hyphens for spaces, no special characters.
- Date is the iteration start date.
- The default branch is `master` (release branches follow `YYYY-MM-DD_release-v{VERSION}`).

## Required Files

Every devlog entry MUST include at minimum:

| File | Purpose | When to fill |
|------|---------|--------------|
| `REQ.md` | Problem statement, acceptance criteria, constraints | **BEFORE** implementation |
| `WORKLOG.md` | Commits, key files, test results, lessons learned | **DURING/AFTER** implementation |

## Optional Files

| File | When to include |
|------|----------------|
| `DESIGN.md` | **Required** for any change affecting architecture, data flow, or module boundaries — in particular changes to the dual-shape export (`packages/billion-context-opencode/src/index.ts`) or the V1/V2 message converters. |
| `NOTES.md` | Ad-hoc notes, investigation logs, debugging traces |

## Rules

1. **Every PR MUST have a corresponding devlog entry.** No exceptions.
2. The devlog folder name MUST match the branch name.
3. At minimum, `REQ.md` and `WORKLOG.md` MUST be present.
4. `DESIGN.md` is required for any change affecting architecture, data flow, or module boundaries.
5. Fill `REQ.md` **BEFORE** implementation (it functions like a ticket).
6. Fill `WORKLOG.md` **DURING/AFTER** implementation.
7. Commit devlog files alongside code changes — not as a separate afterthought.

## Templates

- [`REQ.template.md`](./REQ.template.md) — Copy to your entry folder as `REQ.md`
- [`WORKLOG.template.md`](./WORKLOG.template.md) — Copy to your entry folder as `WORKLOG.md`
- [`DESIGN.template.md`](./DESIGN.template.md) — Copy when architectural changes are involved

## Directory Layout

```
devlog/
├── README.md                           # This file
├── REQ.template.md                     # Template
├── WORKLOG.template.md                 # Template
├── DESIGN.template.md                  # Template
└── 2026-08-13_project-standards/       # Project standards (AGENTS.md, CI, devlog, e2e skeleton)
    ├── REQ.md
    └── WORKLOG.md
```
