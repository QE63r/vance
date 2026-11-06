param(
  [int]$Fps = 2,
  [int]$Width = 960,
  [int]$Quality = 50
)

# 持续抓屏，把每帧 JPEG 按 [4 字节长度 + 数据] 写到 stdout。
# 只启动一次，由 Node 常驻读取，不要每帧起一个进程（那样一帧要 300ms 以上）。
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VnScreen2 {
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@

[void][VnScreen2]::SetProcessDPIAware()

$w = [VnScreen2]::GetSystemMetrics(0)
$h = [VnScreen2]::GetSystemMetrics(1)
if ($w -le 0 -or $h -le 0) { throw "cannot read screen size" }

$ratio = [math]::Min(1.0, $Width / $w)
$ow = [int]($w * $ratio)
$oh = [int]($h * $ratio)

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $Quality

$out = [Console]::OpenStandardOutput()
$delay = [int](1000 / [math]::Max(1, $Fps))

while ($true) {
  try {
    $full = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($full)
    $g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size $w, $h))
    $g.Dispose()

    if ($ratio -lt 1.0) {
      $small = New-Object System.Drawing.Bitmap $ow, $oh
      $g2 = [System.Drawing.Graphics]::FromImage($small)
      $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear
      $g2.DrawImage($full, 0, 0, $ow, $oh)
      $g2.Dispose()
      $full.Dispose()
      $full = $small
    }

    $ms = New-Object System.IO.MemoryStream
    $full.Save($ms, $codec, $ep)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    $full.Dispose()

    $len = [BitConverter]::GetBytes([int]$bytes.Length)
    $out.Write($len, 0, 4)
    $out.Write($bytes, 0, $bytes.Length)
    $out.Flush()
  } catch {
    Start-Sleep -Milliseconds 500
  }

  Start-Sleep -Milliseconds $delay
}
