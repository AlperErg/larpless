# Builds the LarpLess release packages for Windows: a Release build for x64 and ARM64 with the JS
# bundled into the app, packed into one .msixbundle (signed, for installing outside the Store) and,
# with -Store, a .msixupload for Partner Center (the Store signs that one itself).
#
#   powershell -ExecutionPolicy Bypass -File scripts\release-windows.ps1                 build + sign the .msixbundle
#   powershell -ExecutionPolicy Bypass -File scripts\release-windows.ps1 -Store          also make the .msixupload
#   powershell -ExecutionPolicy Bypass -File scripts\release-windows.ps1 -NoSign         build only (Windows refuses to install it)
#   powershell -ExecutionPolicy Bypass -File scripts\release-windows.ps1 -Platforms x64  one architecture (what CI builds)
#
# Output: windows\build\release\LarpLess-<version>.msixbundle (+ .msixupload), gitignored, with the
# MSBuild log next to it. The version comes from package.json.
#
# The JS bundle: Release builds run react-native-windows' own bundler (Bundle.props, UseBundle=true),
# which also compiles it to Hermes bytecode with the hermes.exe from the same NuGet package as the
# engine, so bytecode and engine always match. That's why this doesn't call bundle-windows.ps1 (a dev
# bundle for Debug installs). RNW's bundle step ignores failures (ContinueOnError), so the bundle is
# deleted first and checked afterwards.
#
# Signing (unless -NoSign). The certificate's subject must equal Publisher in
# windows\LarpLess.Package\Package.appxmanifest. Either:
#   - a certificate in your certificate store:  -CertificateThumbprint <sha1>  (or LARPLESS_SIGN_THUMBPRINT)
#   - Azure Artifact Signing (Trusted Signing): -SigningMetadata <metadata.json> -SigningDlib <Azure.CodeSigning.Dlib.dll>
#     (or LARPLESS_SIGN_METADATA / LARPLESS_SIGN_DLIB), signed in with `az login` or the usual Azure env variables.
param(
  [string[]]$Platforms = @('x64', 'ARM64'),
  [switch]$Store,
  [switch]$NoSign,
  [string]$CertificateThumbprint = $env:LARPLESS_SIGN_THUMBPRINT,
  [string]$SigningMetadata = $env:LARPLESS_SIGN_METADATA,
  [string]$SigningDlib = $env:LARPLESS_SIGN_DLIB,
  [string]$TimestampUrl = ''
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Step([string]$text) { Write-Host ''; Write-Host "==> $text" }
function Fail([string]$text) { Write-Host "release-windows: $text" -ForegroundColor Red; exit 1 }

$Platforms = @($Platforms | ForEach-Object { $_ -split '[,|]' } | Where-Object { $_ } | ForEach-Object {
  switch ($_.ToLowerInvariant()) {
    'x64' { 'x64' }
    'arm64' { 'ARM64' }
    default { Fail "unknown platform '$_' (use x64 and/or ARM64)." }
  }
})
if ($Platforms.Count -eq 0) { Fail 'no platforms given.' }

$version = (node -p "require('./package.json').version").Trim()
$manifestPath = 'windows\LarpLess.Package\Package.appxmanifest'
[xml]$manifest = [IO.File]::ReadAllText((Resolve-Path $manifestPath))
$identity = $manifest.Package.Identity
if ($identity.Version -ne "$version.0") {
  Fail "Package.appxmanifest says version $($identity.Version), package.json says $version (expected $version.0)."
}
$publisher = $identity.Publisher

$out = Join-Path $PWD 'windows\build\release'
$bundleDir = Join-Path $PWD 'windows\LarpLess\Bundle'
$bundleFile = Join-Path $bundleDir 'index.windows.bundle'

# --- Tools ---------------------------------------------------------------------------------------

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { Fail 'Visual Studio is not installed (no vswhere.exe).' }
$msbuild = & $vswhere -latest -prerelease -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' |
  Select-Object -First 1
if (-not $msbuild) { Fail 'MSBuild.exe not found. Install Visual Studio with Desktop C++ and WinUI app development.' }

$signtool = $null
if (-not $NoSign) {
  $hostArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $signtool = Get-ChildItem (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin\10.*') -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [version]$_.Name } -Descending |
    ForEach-Object { Join-Path $_.FullName "$hostArch\signtool.exe" } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
  if (-not $signtool) { Fail 'signtool.exe not found in the Windows 10/11 SDK.' }

  if ($CertificateThumbprint) {
    $thumb = ($CertificateThumbprint -replace '\s', '').ToUpperInvariant()
    $cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
      Where-Object { $_.Thumbprint -eq $thumb } | Select-Object -First 1
    if (-not $cert) { Fail "no certificate with thumbprint $thumb in CurrentUser\My or LocalMachine\My." }
    if (-not $cert.HasPrivateKey) { Fail "the certificate $thumb has no private key on this PC." }
    if ($cert.Subject -ne $publisher) {
      Fail "the certificate's subject is '$($cert.Subject)', but Publisher in Package.appxmanifest is '$publisher'. They must match exactly."
    }
    if (-not $TimestampUrl) { $TimestampUrl = 'http://timestamp.digicert.com' }
  } elseif ($SigningMetadata -or $SigningDlib) {
    if (-not ($SigningMetadata -and (Test-Path $SigningMetadata))) { Fail "Artifact Signing metadata file not found: '$SigningMetadata'." }
    if (-not ($SigningDlib -and (Test-Path $SigningDlib))) { Fail "Artifact Signing dlib not found: '$SigningDlib'." }
    if (-not $TimestampUrl) { $TimestampUrl = 'http://timestamp.acs.microsoft.com' }
    Write-Host "note: make sure the Artifact Signing certificate profile's subject is '$publisher' (Publisher in Package.appxmanifest)."
  } else {
    Fail 'nothing to sign with: pass -CertificateThumbprint, or -SigningMetadata and -SigningDlib, or -NoSign to only build.'
  }
}

if (Select-String -Path 'src\config.ts' -Pattern "HOSTED_SUPABASE: \{ url: ''" -Quiet) {
  Write-Host "note: HOSTED_SUPABASE is empty, so Friends in this build works only with 'Use your own server'."
}

# --- Build ---------------------------------------------------------------------------------------

Step "Building LarpLess $version (Release, $($Platforms -join ', '))"
Get-Process LarpLess -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force -Path $out | Out-Null
# Start from an empty Bundle folder (keeping .gitkeep), so a failed bundle step can't ship a stale bundle.
Get-ChildItem $bundleDir -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '.gitkeep' } |
  Remove-Item -Recurse -Force

dotnet tool restore
if ($LASTEXITCODE -ne 0) { Fail 'dotnet tool restore failed.' }
node (Join-Path $PSScriptRoot 'patch-rnsvg-windows.mjs')
if ($LASTEXITCODE -ne 0) { Fail 'patch-rnsvg-windows.mjs failed.' }

$mode = if ($Store) { 'StoreUpload' } else { 'SideloadOnly' }
$log = Join-Path $out 'msbuild.log'
$errLog = Join-Path $out 'msbuild-errors.log'
$msbuildArgs = @(
  'windows\LarpLess.sln',
  '/restore',
  '/m',
  '/nologo',
  '/v:minimal',
  "/flp:LogFile=$log;Verbosity=normal;Encoding=UTF-8",
  "/flp1:LogFile=$errLog;ErrorsOnly;Encoding=UTF-8",
  '/p:Configuration=Release',
  "/p:Platform=$($Platforms[0])",
  '/p:AppxBundle=Always',
  "/p:AppxBundlePlatforms=$($Platforms -join '|')",
  "/p:UapAppxPackageBuildMode=$mode",
  "/p:AppxPackageDir=$out\",
  '/p:AppxPackageSigningEnabled=false',
  '/p:GenerateAppInstallerFile=false'
)
& $msbuild @msbuildArgs
if ($LASTEXITCODE -ne 0) {
  if (Test-Path $errLog) { Get-Content $errLog -Tail 20 | ForEach-Object { Write-Host $_ } }
  Fail "the Release build failed. Errors: $errLog, full log: $log"
}

# --- Checks --------------------------------------------------------------------------------------

Step 'Checking the JS bundle'
if (-not (Test-Path $bundleFile)) { Fail "no JS bundle at ${bundleFile}: the bundle step failed (search the log for 'bundle')." }
# Hermes bytecode starts with the magic number 0x1F1903C103BC1FC6 (little-endian).
$head = [byte[]]::new(8)
$stream = [IO.File]::OpenRead($bundleFile)
try { $null = $stream.Read($head, 0, 8) } finally { $stream.Dispose() }
$hermesMagic = [byte[]](0xC6, 0x1F, 0xBC, 0x03, 0xC1, 0x03, 0x19, 0x1F)
if (($head -join ',') -ne ($hermesMagic -join ',')) { Fail "$bundleFile is not Hermes bytecode: the Hermes compile step failed." }
Write-Host ("Hermes bytecode, {0:N1} MB" -f ((Get-Item $bundleFile).Length / 1MB))

function Find-Output([string[]]$patterns) {
  foreach ($p in $patterns) {
    $f = Get-ChildItem $out -Recurse -File -Filter $p -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($f) { return $f }
  }
  return $null
}

$builtBundle = Find-Output @('*.msixbundle', '*.appxbundle')
if (-not $builtBundle) { Fail "the build produced no .msixbundle under $out." }
$finalBundle = Join-Path $out "LarpLess-$version$($builtBundle.Extension)"
Copy-Item $builtBundle.FullName $finalBundle -Force

$finalUpload = $null
if ($Store) {
  $builtUpload = Find-Output @('*.msixupload', '*.appxupload')
  if (-not $builtUpload) { Fail "the Store build produced no .msixupload under $out." }
  $finalUpload = Join-Path $out "LarpLess-$version$($builtUpload.Extension)"
  Copy-Item $builtUpload.FullName $finalUpload -Force
}

# --- Signing -------------------------------------------------------------------------------------

if ($NoSign) {
  Step 'Done (not signed)'
  Write-Host $finalBundle
  if ($finalUpload) { Write-Host $finalUpload }
  Write-Host 'Windows refuses to install an unsigned package: sign it, or run without -NoSign.'
  exit 0
}

Step 'Signing'
$signArgs = @('sign', '/fd', 'SHA256', '/tr', $TimestampUrl, '/td', 'SHA256')
if ($CertificateThumbprint) {
  $signArgs += @('/sha1', $thumb)
} else {
  $signArgs += @('/dlib', $SigningDlib, '/dmdf', $SigningMetadata)
}
& $signtool @signArgs $finalBundle
if ($LASTEXITCODE -ne 0) { Fail 'signtool sign failed.' }
& $signtool verify /pa /q $finalBundle
if ($LASTEXITCODE -ne 0) { Fail "the signature on $finalBundle doesn't verify (is the certificate's root trusted on this PC?)." }

Step 'Done'
Write-Host "$finalBundle (signed)"
if ($finalUpload) { Write-Host "$finalUpload (for Partner Center; the Store signs it)" }
