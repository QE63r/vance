# 编译桌面壳 v0（.NET Framework 4.8，无 NuGet 依赖）

$ErrorActionPreference = "Stop"
$csc = @(
  "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw "csc.exe not found; need .NET Framework 4.x" }

$outDir = Join-Path $PSScriptRoot "bin"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$exe = Join-Path $outDir "VanceDesktop.exe"
$icon = Join-Path $PSScriptRoot "assets\fanjing.ico"

& $csc /nologo /target:winexe /platform:anycpu /out:"$exe" /win32icon:"$icon" `
  "$PSScriptRoot\VanceDesktop.cs" `
  /r:System.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  /r:System.Net.Http.dll /r:System.Net.Sockets.dll
if ($LASTEXITCODE -ne 0) { throw "csc failed: $LASTEXITCODE" }
Write-Host "built $exe"
