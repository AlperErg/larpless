# Start Metro (if needed) and open the installed LarpLess — only for builds made with run-windows.ps1 -Metro.
# Installs from the default run-windows.ps1 embed JS and launch from Start without Metro.
# Usage (from larpless/):  powershell -ExecutionPolicy Bypass -File scripts\launch-windows.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$Port = 8081
New-Item -ItemType Directory -Force .logs | Out-Null

$pkg = Get-AppxPackage *LarpLess* -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pkg) {
  Write-Error 'LarpLess is not installed. Run scripts\run-windows.ps1 once to build and deploy.'
}

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Write-Host "Starting Metro on port $Port..."
  Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' `
    -ArgumentList '/c', "npx react-native start --port $Port > .logs\metro-$Port.log 2>&1"
}

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
  Write-Warning "Metro on port $Port did not respond within 30s. Check .logs\metro-$Port.log"
}

Write-Host 'Launching LarpLess...'
Start-Process "shell:AppsFolder\$($pkg.PackageFamilyName)!App"
