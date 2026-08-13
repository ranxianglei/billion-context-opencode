# WORKLOG - <Title>

- Task ID: `<YYYY-MM-DD_short-title>`
- Home Repo: `billion-context-opencode`
- Status: InProgress | Done | Rollback
- Updated: <YYYY-MM-DD HH:mm>

## 1. Summary

- **What was done** (1–3 sentences):
- **Why** (1–3 sentences):
- **Behavior / compatibility changes**: <Yes/No, details>
- **Risk level**: Low | Medium | High

## 2. Change Log

### Commits

| Commit | Description |
|--------|-------------|
| `<sha>` | <one-line summary> |
| ... | ... |

### Key Files

- `<path>` — <what changed and why>
- ...

## 3. Design & Implementation Notes

- **Entry point / key function**:
- **Key configuration items**:
- **Key logic explanation** (if non-trivial):

## 4. Testing & Verification

### Build & Test Commands

```sh
# From repo root
npm run typecheck        # all workspaces
npm run build            # billion-context-opencode (tsup)
npm run test             # billion-context-opencode tests
node smoke.mjs           # e2e check against dist (after build)
```

### Test Coverage

- New/modified test files:
- Test count: <N> total, <N> pass, <N> fail
- Key scenarios verified:

### Results

- **PASS/FAIL**:
- **Key logs/data** (optional):

## 5. Risk Assessment & Rollback

- **Risk points**:
- **Rollback method**:
  - Revert commit(s): `<sha>`
  - Rollback impact:
- **Compatibility notes** (dual-shape export, persisted state format, config schema): <Yes/No, details>

## 6. Lessons Learned (optional)

- What went well:
- What could be improved:
- Reusable conclusions:

## 7. Follow-ups (optional)

- [ ]
