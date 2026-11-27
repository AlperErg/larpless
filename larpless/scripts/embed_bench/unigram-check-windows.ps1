# Checks the C++ Unigram tokenizer (windows/LarpLess/Native/FLUnigram.h) against unigram_cases.json, the token ids
# Hugging Face's tokenizer gives for fixed sample strings (never user text). Compiles the header standalone with the
# Visual Studio C++ toolset (no app build needed) and prints "unigram N/M identical".
# Usage, from larpless/:
#   powershell -ExecutionPolicy Bypass -File scripts\embed_bench\unigram-check-windows.ps1 [-Vocab <minilm-ml-vocab.txt>] [-Cases <file>]
# -Vocab defaults to scripts\embed_bench\minilm-ml-vocab.txt, the file the app converts the downloaded unigram.json
# into (written by export_prompts.py --text-model minilm-ml; not committed); -Cases to unigram_cases.json (another
# file in the same format works too).
param(
  [string]$Vocab = (Join-Path $PSScriptRoot 'minilm-ml-vocab.txt'),
  [string]$Cases = (Join-Path $PSScriptRoot 'unigram_cases.json')
)
$ErrorActionPreference = 'Stop'

$larpless = Resolve-Path (Join-Path $PSScriptRoot '..\..')
if (-not (Test-Path $Vocab)) { throw "no vocabulary at $Vocab (run export_prompts.py --text-model minilm-ml --text-only first)" }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio with the C++ toolset not found' }
$env:PATH = "$(Split-Path $vswhere);$env:PATH"  # vcvarsall calls vswhere by name
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }

$work = Join-Path ([IO.Path]::GetTempPath()) ("unigram-check-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $exe = Join-Path $work 'unigram_check.exe'
  $src = Join-Path $PSScriptRoot 'unigram_check.cpp'
  $inc = Join-Path $larpless 'windows\LarpLess\Native'
  $build = "`"$vs\VC\Auxiliary\Build\vcvarsall.bat`" $arch >nul && cl /nologo /std:c++17 /EHsc /O2 /W4 /WX /I `"$inc`" `"$src`" /Fo`"$work\unigram_check.obj`" /Fe`"$exe`" >`"$work\build.log`""
  cmd /c $build
  if ($LASTEXITCODE -ne 0) { Get-Content "$work\build.log"; throw 'compile failed' }
  & $exe $Vocab $Cases
  exit $LASTEXITCODE
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
