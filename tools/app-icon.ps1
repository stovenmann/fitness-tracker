# Draws the Fitness Tracker Home Screen icon: a dumbbell in the app's colours (ink, paper, red).
# Uses the drawing library built into Windows; nothing to install.
#   powershell -ExecutionPolicy Bypass -File tools\app-icon.ps1
# Writes public/icons/apple-touch-icon.png (180) for the iPhone, and icon-192.png and icon-512.png
# for the web-app manifest, where Cloudflare serves them (see CLOUDFLARE.md). iOS rounds the
# corners itself, so the square is full bleed.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$S = 1024
$site = Join-Path (Split-Path $PSScriptRoot -Parent) "public\icons"
$ink = [System.Drawing.ColorTranslator]::FromHtml("#131D24")
$paper = [System.Drawing.ColorTranslator]::FromHtml("#F7F8F6")
$red = [System.Drawing.ColorTranslator]::FromHtml("#C9252D")
$redDeep = [System.Drawing.ColorTranslator]::FromHtml("#A31B23")

function RoundRect($g, $color, $x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc([single]$x, [single]$y, [single]$d, [single]$d, 180, 90)
  $p.AddArc([single]($x + $w - $d), [single]$y, [single]$d, [single]$d, 270, 90)
  $p.AddArc([single]($x + $w - $d), [single]($y + $h - $d), [single]$d, [single]$d, 0, 90)
  $p.AddArc([single]$x, [single]($y + $h - $d), [single]$d, [single]$d, 90, 90)
  $p.CloseFigure()
  $b = New-Object System.Drawing.SolidBrush $color
  $g.FillPath($b, $p)
  $b.Dispose(); $p.Dispose()
}

$bmp = New-Object System.Drawing.Bitmap $S, $S
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear($ink)

# A horizontal dumbbell centred on the icon: bar, then two plates and an end cap each side.
$cy = 512
RoundRect $g $paper 250 ($cy - 30) 524 60 30            # bar
foreach ($side in @(-1, 1)) {
  $inner = if ($side -lt 0) { 300 } else { 1024 - 300 - 92 }
  $outer = if ($side -lt 0) { 222 } else { 1024 - 222 - 70 }
  $cap = if ($side -lt 0) { 186 } else { 1024 - 186 - 40 }
  RoundRect $g $red $inner ($cy - 226) 92 452 30        # big plate
  RoundRect $g $redDeep $outer ($cy - 160) 70 320 26    # small plate
  RoundRect $g $paper $cap ($cy - 62) 40 124 16         # end cap
}
$g.Dispose()

function Save-Size($src, $size, $name) {
  $out = New-Object System.Drawing.Bitmap $size, $size
  $g2 = [System.Drawing.Graphics]::FromImage($out)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g2.DrawImage($src, 0, 0, $size, $size)
  $g2.Dispose()
  $path = Join-Path $site $name
  if (Test-Path $path) { Remove-Item -Force $path }   # GDI+ can't always save over a file
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
}
New-Item -ItemType Directory -Force $site | Out-Null
Save-Size $bmp 180 "apple-touch-icon.png"
Save-Size $bmp 192 "icon-192.png"
Save-Size $bmp 512 "icon-512.png"
$bmp.Dispose()
Write-Output "icons written to $site"
