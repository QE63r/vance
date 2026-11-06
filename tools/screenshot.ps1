param([string]$Out = "$env:TEMP\vance-shot.png")

# Capture the primary screen, downscale to max width 1440.
# Avoid System.Windows.Forms (not loadable in some hosts); use user32 via P/Invoke.
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VnScreen {
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@

[void][VnScreen]::SetProcessDPIAware()
$w = [VnScreen]::GetSystemMetrics(0)
$h = [VnScreen]::GetSystemMetrics(1)
if ($w -le 0 -or $h -le 0) { throw "cannot read screen size" }

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size $w, $h))
$g.Dispose()

$maxW = 1280
if ($w -gt $maxW) {
  $ratio = $maxW / $w
  $nw = [int]($w * $ratio); $nh = [int]($h * $ratio)
  $small = New-Object System.Drawing.Bitmap $nw, $nh
  $g2 = [System.Drawing.Graphics]::FromImage($small)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $nw, $nh)
  $g2.Dispose()
  $bmp.Dispose()
  $bmp = $small
}

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 80
$bmp.Save($Out, $codec, $ep)
$bmp.Dispose()
Write-Output $Out
