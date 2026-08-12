# Clean end-to-end test for billion-context-opencode-v2.
#
# Loads ONLY this plugin (compaction disabled) via an isolated OPENCODE_CONFIG,
# then drives a multi-step run that exercises bili_status -> bili_compress ->
# bili_search through the real opencode2 runtime.
#
# Usage:
#   powershell -File run-test.ps1            # one combined scenario
#   powershell -File run-test.ps1 -Scenario probe   # context-hook dump only

param(
  [string]$Scenario = "e2e"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dir = $PSScriptRoot
$log = Join-Path $dir "bili-debug.log"
if (Test-Path $log) { Remove-Item $log }

if (-not (Test-Path (Join-Path $root "dist\index.js"))) {
  Write-Host "dist/index.js missing - run: npm run build" -ForegroundColor Red
  exit 1
}

$env:OPENCODE_CONFIG = $dir
$env:BILI_ACP_DEBUG = "1"
# Point state at a throwaway location so the test never touches real sessions.
$env:BILI_ACP_STATE_DIR = Join-Path $dir "state"

if ($Scenario -eq "probe") {
  opencode2 run "Use the bili_status tool and report exactly what it returns."
  exit $LASTEXITCODE
}

$prompt = @'
This is a context-compression test. Perform these steps IN ORDER using ONLY the bili_* tools:

1. Use the shell tool to run this EXACT command: cmd /c echo LINE 1 0123456789 & echo LINE 2 0123456789 & echo LINE 3 0123456789 & echo LINE 4 0123456789 & echo LINE 5 0123456789
   Use only that one shell call.
2. Call bili_status with no arguments and note the message references it lists.
3. Call bili_compress to compress the ENTIRE shell tool output from step 1 into a short summary, using the message references from step 2. Topic: "shell-output-test".
4. Call bili_status again.
5. Reply with a report: (a) the bili_status refs from step 2, (b) the bili_compress result from step 3, (c) the bili_status output from step 4. Label each part. Do not call any other tools.
'@

Write-Host "Running e2e scenario against opencode2..."
opencode2 run $prompt 2>&1
$code = $LASTEXITCODE
Write-Host "exit=$code"
exit $code
