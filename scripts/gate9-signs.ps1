# Gate 9 sign textures. Text transcribed from the user's 2026-10-15 photographs
# (direction board: photo 20261015_104147; ITPO barrier sign: 20261015_180717;
# ENTRY wall sign: 20261015_180717). Rendered with Windows fonts, no logo artwork:
# the ITPO roundel is lettering only because the emblem itself is not reproduced.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gate9-signs.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\work\gate9\signs'
New-Item -ItemType Directory -Force $out | Out-Null

function New-Canvas([int]$w, [int]$h, [System.Drawing.Color]$bg) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear($bg)
  return @($bmp, $g)
}
function Save($bmp, $name) { $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png); Write-Output "wrote $name" }
function Font($size, $bold = $true) {
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  New-Object System.Drawing.Font('Arial', [single]$size, $style, [System.Drawing.GraphicsUnit]::Pixel)
}
$white = [System.Drawing.Brushes]::White
$centre = New-Object System.Drawing.StringFormat; $centre.Alignment = 'Center'; $centre.LineAlignment = 'Center'
$left = New-Object System.Drawing.StringFormat; $left.Alignment = 'Near'; $left.LineAlignment = 'Center'

# 1. Blue direction board (1024 x 512): three rows, arrow glyph in a white square.
$bmp, $g = New-Canvas 1024 512 ([System.Drawing.Color]::FromArgb(255, 22, 92, 170))
$g.FillRectangle([System.Drawing.Brushes]::White, 0, 0, 1024, 84)
$g.DrawString('ITPO  -  BHARAT MANDAPAM', (Font 40), (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 22, 92, 170))), (New-Object System.Drawing.RectangleF 0, 0, 1024, 84), $centre)
$rows = @(
  @('↑', 'HALL 7-12A', 'GATE 10, 11 & 1'),
  @('→', 'HALL 1-6', 'GATE 6, 7 & 8  •  ITPO OFFICE (ADMIN BLOCK)'),
  @('↶', 'BASEMENT PARKING', '(ADMIN BLOCK)')
)
$y = 100
foreach ($row in $rows) {
  $g.FillRectangle([System.Drawing.Brushes]::White, 34, $y + 14, 100, 100)
  $g.DrawString($row[0], (Font 84), (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 22, 92, 170))), (New-Object System.Drawing.RectangleF 34, ($y + 8), 100, 110), $centre)
  $g.DrawString($row[1], (Font 54), $white, (New-Object System.Drawing.RectangleF 160, $y, 860, 64), $left)
  $g.DrawString($row[2], (Font 36 $false), $white, (New-Object System.Drawing.RectangleF 160, ($y + 66), 860, 54), $left)
  $y += 138
}
Save $bmp 'direction-board.png'

# 2. ITPO barrier nameplate (1024 x 160): brushed gold plate, dark lettering.
$bmp, $g = New-Canvas 1024 160 ([System.Drawing.Color]::FromArgb(255, 196, 170, 96))
$dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 28, 24, 16))
$g.DrawString('INDIA TRADE PROMOTION ORGANISATION', (Font 54), $dark, (New-Object System.Drawing.RectangleF 0, 10, 1024, 76), $centre)
$g.DrawString('(A GOVERNMENT OF INDIA ENTERPRISE)', (Font 40 $false), $dark, (New-Object System.Drawing.RectangleF 0, 86, 1024, 60), $centre)
Save $bmp 'itpo-nameplate.png'

# 3. ITPO roundel (512 x 512): blue disc, ring lettering, white centre panel with orange ITPO.
$bmp, $g = New-Canvas 512 512 ([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
$blue = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 20, 70, 150))
$g.FillEllipse($blue, 4, 4, 504, 504)
$g.DrawString('BHARAT MANDAPAM', (Font 46), $white, (New-Object System.Drawing.RectangleF 0, 70, 512, 60), $centre)
$g.DrawString('NEW DELHI', (Font 46), $white, (New-Object System.Drawing.RectangleF 0, 380, 512, 60), $centre)
$g.FillRectangle([System.Drawing.Brushes]::White, 136, 176, 240, 150)
$orange = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 232, 110, 20))
$g.DrawString('ITPO', (Font 96), $orange, (New-Object System.Drawing.RectangleF 136, 220, 240, 100), $centre)
$g.DrawString('आई टी पी ओ', (New-Object System.Drawing.Font('Nirmala UI', 34, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)), $blue, (New-Object System.Drawing.RectangleF 136, 178, 240, 46), $centre)
Save $bmp 'itpo-roundel.png'

# 4. ENTRY wall sign (512 x 256): red panel, white lettering.
$bmp, $g = New-Canvas 512 256 ([System.Drawing.Color]::FromArgb(255, 178, 28, 32))
$g.DrawString('ENTRY', (Font 120), $white, (New-Object System.Drawing.RectangleF 0, 40, 512, 130), $centre)
$g.DrawString('BHARAT MANDAPAM', (Font 34 $false), $white, (New-Object System.Drawing.RectangleF 0, 180, 512, 50), $centre)
Save $bmp 'entry-sign.png'
