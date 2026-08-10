#!/usr/bin/env bash
# Clean opencode test environment for billion-context-opencode.
# Isolates from any other compression plugins (e.g. opencode-acp) by pointing
# XDG_CONFIG_HOME at a fresh config dir that loads ONLY this plugin.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$HERE/../dist/index.js"

if [ ! -f "$DIST" ]; then
  echo "Building plugin first (dist/index.js missing)..."
  (cd "$HERE/.." && npm run build)
fi

# Rewrite the plugin path in opencode.json so the config is portable across
# machines / checkouts (no hardcoded absolute path). Done every run so a moved
# checkout stays correct.
OCONF="$HERE/config/opencode/opencode.json"
node -e "
const fs = require('fs');
const p = process.argv[1];
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.plugin = [process.argv[2]];
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
" "$OCONF" "$DIST"

export XDG_CONFIG_HOME="$HERE/config"
cd "$HERE/workspace"

echo "=== billion-context-opencode clean test env ==="
echo "XDG_CONFIG_HOME = $XDG_CONFIG_HOME"
echo "workspace       = $(pwd)"
echo "plugin          = $DIST"
echo "================================================"
echo "Only billion-context-opencode is loaded. Built-in compaction is disabled."
echo "Run the 4 bili_ tools: bili_compress, bili_decompress, bili_search, bili_status"
echo

exec opencode "$@"
