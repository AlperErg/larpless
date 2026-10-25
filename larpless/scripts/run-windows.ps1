# Build, deploy and launch LarpLess on Windows.
# Default: embed the JS bundle in the package (no Metro needed day to day).
# Usage (from larpless/):
#   powershell -ExecutionPolicy Bypass -File scripts\run-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\run-windows.ps1 -Metro   # load JS from Metro :8081 (active dev)
param(
  [switch]$Metro
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$Port = 8081
New-Item -ItemType Directory -Force .logs | Out-Null

Get-Process LarpLess -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-AppxPackage *LarpLess* -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "Removing installed package $($_.Name) $($_.Version)..."
  Remove-AppxPackage -Package $_.PackageFullName -ErrorAction SilentlyContinue
}

$msbuildprops = ''
if ($Metro) {
  $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $listening) {
    Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' `
      -ArgumentList '/c', "npx react-native start --port $Port > .logs\metro-$Port.log 2>&1"
  }
  foreach ($i in 1..60) {
    try {
      $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/status" -UseBasicParsing -TimeoutSec 2
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
} else {
  & (Join-Path $PSScriptRoot 'bundle-windows.ps1')
  $msbuildprops = 'EmbedJsBundle=true'
}

dotnet tool restore
node (Join-Path $PSScriptRoot 'patch-rnsvg-windows.mjs')

if ($msbuildprops) {
  npx @react-native-community/cli run-windows --no-packager --logging --msbuildprops $msbuildprops
} else {
  npx @react-native-community/cli run-windows --no-packager --logging
}
