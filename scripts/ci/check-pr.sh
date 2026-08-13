#!/usr/bin/env bash
# PR validation script — enforces AGENTS.md contributing standards.
#
# Checks:
#   1. Branch name matches YYYY-MM-DD_short-title
#   2. devlog/{branch-name}/REQ.md exists
#   3. devlog/{branch-name}/WORKLOG.md exists
#   4. If packages/billion-context-opencode/package.json version changed,
#      README.md must be modified AND contain "### v{VERSION}" in its changelog
#
# Usage: bash scripts/ci/check-pr.sh [branch-name] [base-ref]
#   branch-name defaults to $GITHUB_HEAD_REF or the current branch
#   base-ref    defaults to "origin/master"
#
# Exit codes: 0 = all checks passed, 1 = one or more checks failed

set -euo pipefail

BRANCH="${1:-${GITHUB_HEAD_REF:-$(git branch --show-current)}}"
BASE="${2:-origin/master}"

# The single published package's manifest — the only place a version bump is valid.
PKG="packages/billion-context-opencode/package.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

errors=0
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; errors=$((errors + 1)); }
pass() { echo -e "${GREEN}✓ $1${NC}"; }

echo "=== PR Validation ==="
echo "Branch: $BRANCH"
echo "Base:   $BASE"
echo ""

# ── Check 1: Branch name convention ──────────────────────────
echo "── Branch name convention ──"
if echo "$BRANCH" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}_[a-z0-9.-]+$'; then
    pass "Branch name matches YYYY-MM-DD_short-title"
else
    fail "Branch name '$BRANCH' does not match YYYY-MM-DD_short-title (e.g., 2026-08-13_compress-fix)"
    echo "  Required format: digits-digits-digits_lowercase-kebab-case"
fi
echo ""

# ── Checks 2 & 3: Devlog exists ──────────────────────────────
echo "── Devlog entry ──"
DEVLOG_DIR="devlog/$BRANCH"
if [ -f "$DEVLOG_DIR/REQ.md" ]; then
    pass "devlog/$BRANCH/REQ.md exists"
else
    fail "devlog/$BRANCH/REQ.md is missing (required by AGENTS.md §5.1.2)"
fi

if [ -f "$DEVLOG_DIR/WORKLOG.md" ]; then
    pass "devlog/$BRANCH/WORKLOG.md exists"
else
    fail "devlog/$BRANCH/WORKLOG.md is missing (required by AGENTS.md §5.1.2)"
fi
echo ""

# ── Check 4: Changelog updated when version changes ──────────
echo "── Changelog check ──"
# Read version from the current (PR) tree's published package manifest.
CURRENT_VERSION=$(node -p "require('./$PKG').version" 2>/dev/null || echo "")
# Read version from the base ref's copy of the same manifest.
BASE_VERSION=$(git show "$BASE:$PKG" 2>/dev/null | node -e "
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
    try { console.log(JSON.parse(Buffer.concat(chunks).toString()).version); }
    catch { console.log(''); }
});
" 2>/dev/null || echo "")

if [ -z "$CURRENT_VERSION" ]; then
    warn "Could not read version from $PKG — skipping changelog check"
elif [ -z "$BASE_VERSION" ]; then
    warn "Could not read version from $BASE:$PKG — skipping changelog check"
elif [ "$CURRENT_VERSION" = "$BASE_VERSION" ]; then
    pass "Version unchanged ($CURRENT_VERSION) — changelog check skipped"
else
    echo "  Version change: $BASE_VERSION → $CURRENT_VERSION"

    # Was README.md modified in this PR (diff against the three-dot merge base)?
    README_CHANGED=$(git diff --name-only "$BASE"...HEAD -- README.md 2>/dev/null | wc -l)

    if [ "$README_CHANGED" -eq 0 ]; then
        fail "Version bumped ($BASE_VERSION → $CURRENT_VERSION) but README.md not modified"
        echo "  AGENTS.md §5.4.2 requires a changelog entry in README.md for version changes"
    else
        pass "README.md modified — checking version string..."

        if grep -q "### v${CURRENT_VERSION}" README.md 2>/dev/null; then
            pass "README.md changelog contains '### v$CURRENT_VERSION'"
        else
            fail "README.md changelog does not contain '### v$CURRENT_VERSION'"
        fi
    fi
fi
echo ""

# ── Summary ──────────────────────────────────────────────────
echo "=== Summary ==="
if [ "$errors" -eq 0 ]; then
    echo -e "${GREEN}All checks passed ✓${NC}"
    exit 0
else
    echo -e "${RED}$errors check(s) failed${NC}"
    exit 1
fi
