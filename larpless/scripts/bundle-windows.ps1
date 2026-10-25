# Produce the offline JS bundle packaged next to LarpLess.exe (see windows/LarpLess/LarpLess.cpp).
# Usage (from larpless/):  powershell -ExecutionPolicy Bypass -File scripts\bundle-windows.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$outDir = Join-Path $PWD 'windows\LarpLess\Bundle'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$bundle = Join-Path $outDir 'index.windows.bundle'
Write-Host "Bundling JS to $bundle ..."
# Debug packages use a Debug build; --dev true matches what Hermes expects when EmbedJsBundle is set.
npx react-native bundle `
  --platform windows `
  --dev true `
  --entry-file index.js `
  --bundle-output $bundle `
  --assets-dest $outDir

if (-not (Test-Path $bundle)) {
  throw "Bundle step failed: $bundle was not created."
}
Write-Host 'Bundle complete.'
