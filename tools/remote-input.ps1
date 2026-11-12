param()

# stdin 是 Node 写的 UTF-8 JSON；不显式设编码，中文会乱码。
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

# 常驻输入进程：stdin 每行一个 JSON，不执行任意命令，只做鼠标/键盘注入。
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VnInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
}
"@
[void][VnInput]::SetProcessDPIAware()

$W = [VnInput]::GetSystemMetrics(0)
$H = [VnInput]::GetSystemMetrics(1)
$LEFTDOWN = 0x0002; $LEFTUP = 0x0004
$RIGHTDOWN = 0x0008; $RIGHTUP = 0x0010
$WHEEL = 0x0800; $KEYUP = 0x0002

$VK = @{
  Enter = 13; Backspace = 8; Escape = 27; Tab = 9; Delete = 46
  ArrowLeft = 37; ArrowRight = 39; ArrowUp = 38; ArrowDown = 40
  Home = 36; End = 35; PageUp = 33; PageDown = 34
}

function Move-To([double]$nx, [double]$ny) {
  $x = [int]([Math]::Min(1, [Math]::Max(0, $nx)) * ($W - 1))
  $y = [int]([Math]::Min(1, [Math]::Max(0, $ny)) * ($H - 1))
  [void][VnInput]::SetCursorPos($x, $y)
}

function Press-CtrlV {
  [VnInput]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
  [VnInput]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)
  [VnInput]::keybd_event(0x56, 0, $KEYUP, [UIntPtr]::Zero)
  [VnInput]::keybd_event(0x11, 0, $KEYUP, [UIntPtr]::Zero)
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $j = $line | ConvertFrom-Json
    switch ($j.type) {
      "pointer" {
        if ($null -eq $j.x -or $null -eq $j.y) { break }
        Move-To ([double]$j.x) ([double]$j.y)
        $button = if ($j.button -eq "right") { "right" } else { "left" }
        switch ($j.action) {
          "down" { if ($button -eq "right") { [VnInput]::mouse_event($RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero) } else { [VnInput]::mouse_event($LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero) } }
          "up" { if ($button -eq "right") { [VnInput]::mouse_event($RIGHTUP, 0, 0, 0, [UIntPtr]::Zero) } else { [VnInput]::mouse_event($LEFTUP, 0, 0, 0, [UIntPtr]::Zero) } }
          "click" {
            if ($button -eq "right") {
              [VnInput]::mouse_event($RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
              [VnInput]::mouse_event($RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
            } else {
              [VnInput]::mouse_event($LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
              [VnInput]::mouse_event($LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
            }
          }
          "wheel" {
            $delta = if ($null -ne $j.deltaY) { [int]$j.deltaY } else { 0 }
            [VnInput]::mouse_event($WHEEL, 0, 0, $delta, [UIntPtr]::Zero)
          }
        }
      }
      "key" {
        $code = $VK[[string]$j.key]
        if ($null -ne $code) {
          [VnInput]::keybd_event([byte]$code, 0, 0, [UIntPtr]::Zero)
          [VnInput]::keybd_event([byte]$code, 0, $KEYUP, [UIntPtr]::Zero)
        }
      }
      "text" {
        if ([string]::IsNullOrEmpty([string]$j.text)) { break }
        try {
          Set-Clipboard -Value ([string]$j.text)
        } catch {
          try { [System.Windows.Forms.Clipboard]::SetText([string]$j.text) } catch { break }
        }
        Start-Sleep -Milliseconds 40
        Press-CtrlV
      }
    }
  } catch {
    # 单条坏输入不能杀进程
  }
}
