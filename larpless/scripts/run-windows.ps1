# Windows counterpart of run-mac.sh: start Metro (if needed), then build, deploy and launch the Debug app.
# Usage (from larpless/):  powershell -ExecutionPolicy Bypass -File scripts/run-windows.ps1
# The Windows app loads its bundle from Metro on the default port 8081.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$Port = 8081
New-Item -ItemType Directory -Force .logs | Out-Null

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' `
    -ArgumentList '/c', "npx react-native start --port $Port > .logs\metro-$Port.log 2>&1"
}

# The deploy step needs PowerShell 7 (pwsh.exe); restore it as a .NET local tool (dotnet-tools.json).
dotnet tool restore

npx @react-native-community/cli run-windows --no-packager --logging
