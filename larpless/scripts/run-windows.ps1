# Windows counterpart of run-mac.sh: start Metro (if needed), then build, deploy and launch the Debug app.
# Usage (from larpless/):  powershell -ExecutionPolicy Bypass -File scripts/run-windows.ps1
# The Windows app loads its bundle from Metro on the default port 8081.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$Port = 8081
New-Item -ItemType Directory -Force .logs | Out-Null

# Drop the sideloaded package so deploy always picks up the new build (not a stale AppX).
Get-Process LarpLess -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-AppxPackage *LarpLess* -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "Removing installed package $($_.Name) $($_.Version)..."
  Remove-AppxPackage -Package $_.PackageFullName -ErrorAction SilentlyContinue
}

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' `
    -ArgumentList '/c', "npx react-native start --port $Port > .logs\metro-$Port.log 2>&1"
}

# Launching before Metro is ready leaves the window blank for a long time on first bundle.
$metroReady = $false
foreach ($i in 1..60) {
  try {
    $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/status" -UseBasicParsing -TimeoutSec 2
    $metroReady = $true
    break
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
if (-not $metroReady) {
  Write-Warning "Metro on port $Port did not respond within 30s; continuing anyway."
}

# The deploy step needs PowerShell 7 (pwsh.exe); restore it as a .NET local tool (dotnet-tools.json).
dotnet tool restore

node (Join-Path $PSScriptRoot 'patch-rnsvg-windows.mjs')

npx @react-native-community/cli run-windows --no-packager --logging
