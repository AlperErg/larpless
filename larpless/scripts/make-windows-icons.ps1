# Regenerates the Windows app icons from brand/larpless-logo.png:
#   windows/LarpLess/LarpLess.ico          exe + window icon (16-256 px, PNG-compressed entries)
#   windows/LarpLess.Package/Images/*.png  MSIX tile, taskbar, Start, store and splash assets
# Usage (from larpless/):  powershell -ExecutionPolicy Bypass -File scripts/make-windows-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
# .NET resolves relative paths against the process directory, not the PowerShell location, so build absolute ones.
$root = Split-Path -Parent $PSScriptRoot

$logo = [System.Drawing.Bitmap]::FromFile((Join-Path $root '..\brand\larpless-logo.png'))

# The brand PNG is the macOS icon: an 823 px rounded tile at (100,100) on an opaque white canvas with a baked
# drop shadow. Windows draws its own plates and shadows, so cut the tile out with an anti-aliased rounded mask.
$tileX = 100; $tileSize = 823; $radius = 185
$tile = New-Object System.Drawing.Bitmap $tileSize, $tileSize
$g = [System.Drawing.Graphics]::FromImage($tile)
$g.SmoothingMode = 'AntiAlias'
$g.PixelOffsetMode = 'HighQuality'
$brush = New-Object System.Drawing.TextureBrush $logo
$brush.TranslateTransform(-$tileX, -$tileX)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = 2 * $radius; $e = $tileSize - $d
$path.AddArc(0, 0, $d, $d, 180, 90); $path.AddArc($e, 0, $d, $d, 270, 90)
$path.AddArc($e, $e, $d, $d, 0, 90); $path.AddArc(0, $e, $d, $d, 90, 90)
$path.CloseFigure()
$g.FillPath($brush, $path)
$g.Dispose(); $brush.Dispose(); $path.Dispose(); $logo.Dispose()

# Draws the tile scaled to $size x $size, centred on a transparent $width x $height canvas.
function New-Canvas([int]$width, [int]$height, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $width, $height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.CompositingQuality = 'HighQuality'
  $attrs = New-Object System.Drawing.Imaging.ImageAttributes
  $attrs.SetWrapMode('TileFlipXY') # no dark fringe from sampling outside the source
  $dest = New-Object System.Drawing.Rectangle ([int](($width - $size) / 2)), ([int](($height - $size) / 2)), $size, $size
  $g.DrawImage($tile, $dest, 0, 0, $tileSize, $tileSize, 'Pixel', $attrs)
  $g.Dispose(); $attrs.Dispose()
  return $bmp
}

function Save-Png([string]$file, [int]$width, [int]$height, [int]$size) {
  $bmp = New-Canvas $width $height $size
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# Package assets. Tiles keep the ~66% safe area Windows recommends; taskbar/Start list icons fill the canvas.
$images = Join-Path $root 'windows\LarpLess.Package\Images'
Save-Png "$images\Square44x44Logo.scale-200.png" 88 88 88
foreach ($t in 16, 24, 32, 48, 256) {
  Save-Png "$images\Square44x44Logo.targetsize-$($t)_altform-unplated.png" $t $t $t
}
Save-Png "$images\Square150x150Logo.scale-200.png" 300 300 198
Save-Png "$images\Wide310x150Logo.scale-200.png" 620 300 198
Save-Png "$images\SplashScreen.scale-200.png" 1240 600 300
Save-Png "$images\LockScreenLogo.scale-200.png" 48 48 48
Save-Png "$images\StoreLogo.png" 50 50 50

# Multi-size .ico with PNG entries (supported since Vista; rc.exe embeds them as-is).
$sizes = 16, 20, 24, 32, 40, 48, 64, 96, 128, 256
$pngs = foreach ($s in $sizes) {
  $bmp = New-Canvas $s $s $s
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  , $ms.ToArray()
}
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dim = [byte]($sizes[$i] % 256) # 0 means 256
  $w.Write($dim); $w.Write($dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $root 'windows\LarpLess\LarpLess.ico'), $out.ToArray())
$w.Dispose()
$tile.Dispose()
Write-Host 'Windows icons regenerated.'
