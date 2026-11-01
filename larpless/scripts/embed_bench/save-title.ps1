# Save the foreground window's process and full title for a bench screenshot (no "..." truncation).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\embed_bench\save-title.ps1 <name> [-Dir <folder>] [-Delay <s>]
# Run it, click into the window you're about to screenshot, and wait for the beep. Writes <Dir>\<name>.txt.
# PRIVACY: writes the title only to the folder you choose; nothing is captured or sent.
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$Dir = "$env:USERPROFILE\Desktop\larpless real screenshots\batch2",
  [int]$Delay = 5
)
$ErrorActionPreference = 'Stop'

Add-Type -Namespace LL -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
'@

Write-Host "Click into the window you want: saving its title in $Delay s..."
Start-Sleep -Seconds $Delay
$h = [LL.Win]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 2048
[void][LL.Win]::GetWindowText($h, $sb, $sb.Capacity)
$procId = [uint32]0
[void][LL.Win]::GetWindowThreadProcessId($h, [ref]$procId)
$proc = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName

New-Item -ItemType Directory -Force $Dir | Out-Null
"ProcessName     : $proc`r`nMainWindowTitle : $sb" | Out-File -Encoding utf8 (Join-Path $Dir "$Name.txt")
[console]::Beep(880, 200)
Write-Host "Saved $Name.txt -> [$proc] $sb"
