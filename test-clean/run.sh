#!/usr/bin/env bash
# Clean opencode test environment for billion-context-opencode.
# Isolates from any other compression plugins (e.g. opencode-acp) by pointing
# XDG_CONFIG_HOME at a fresh config dir that loads ONLY this plugin.
#
# The plugin is pulled from npm ("billion-context-opencode"), so there are no
# hardcoded absolute paths — opencode installs it on demand. To test a local
# build instead, set PLUGIN="/abs/path/to/dist/index.js" before running.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="${PLUGIN:-billion-context-opencode}"

export XDG_CONFIG_HOME="$HERE/config"
cd "$HERE/workspace"

# If PLUGIN points at a local dist, make sure it's built.
if [[ "$PLUGIN" == /* ]] && [ ! -f "$PLUGIN" ]; then
  echo "Building plugin first ($PLUGIN missing)..."
  (cd "$HERE/.." && npm run build)
fi

# Write the plugin specifier into opencode.json (keeps the committed config a
# portable npm reference; a local PLUGIN override is applied here only).
OCONF="$HERE/config/opencode/opencode.json"
node -e "
const fs = require('fs');
const p = process.argv[1], spec = process.argv[2];
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.plugin = [spec];
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
" "$OCONF" "$PLUGIN"

echo "=== billion-context-opencode clean test env ==="
echo "XDG_CONFIG_HOME = $XDG_CONFIG_HOME"
echo "workspace       = $(pwd)"
echo "plugin          = $PLUGIN"
echo "================================================"
echo "Only billion-context-opencode is loaded. Built-in compaction is disabled."
echo "Run the 4 bili_ tools: bili_compress, bili_decompress, bili_search, bili_status"
echo "  (local build: PLUGIN=\$PWD/../dist/index.js $0)"
echo

exec opencode "$@"
