# Run on Windows. Deterministic size/padding exports from the approved master.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$repository = Split-Path $PSScriptRoot
$masterPath = Join-Path $repository 'assets/branding/streamio4fire-icon.png'
$master = [Drawing.Image]::FromFile($masterPath)
try {
    $background = ([Drawing.Bitmap]$master).GetPixel(0, 0)
    $exports = @(
        @{Width=512; Height=512; Size=320; Path='torrent-probe/stremio-wrapper/assets/image/streamio4fire-icon.png'},
        @{Width=1280; Height=720; Size=512; Path='assets/branding/streamio4fire-tv-tile.png'}
    )
    foreach ($export in $exports) {
        $outputPath = Join-Path $repository $export.Path
        New-Item -ItemType Directory -Force (Split-Path $outputPath) | Out-Null
        $bitmap = [Drawing.Bitmap]::new($export.Width, $export.Height)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear($background)
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage($master, [int](($export.Width-$export.Size)/2), [int](($export.Height-$export.Size)/2), $export.Size, $export.Size)
            $bitmap.Save($outputPath, [Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
        Get-Item -LiteralPath $outputPath | Select-Object Name,Length
    }
} finally { $master.Dispose() }
