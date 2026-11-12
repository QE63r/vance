# Build native screen capture helper (no NuGet).
$ErrorActionPreference = "Stop"
$csc = @(
  "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw "csc.exe not found" }
$out = Join-Path $PSScriptRoot "screen-capture.exe"
& $csc /nologo /target:exe /platform:anycpu /out:"$out" `
  "$PSScriptRoot\screen-capture.cs" `
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll
if ($LASTEXITCODE -ne 0) { throw "csc failed: $LASTEXITCODE" }
Write-Host "built $out"
