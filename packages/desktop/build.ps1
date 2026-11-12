# Build the desktop shell (native WebView2)
$ErrorActionPreference = "Stop"
$dotnet = (Get-Command dotnet -ErrorAction Stop).Source
$outDir = Join-Path $PSScriptRoot "bin"

$running = Get-Process -Name VanceDesktop -ErrorAction SilentlyContinue
if ($running) {
  throw "VanceDesktop.exe is running; quit it from the tray before building."
}

if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$publishArgs = @(
  "publish",
  (Join-Path $PSScriptRoot "VanceDesktop.csproj"),
  "-c", "Release",
  "-r", "win-x64",
  "--self-contained", "false",
  "-o", $outDir
)
& $dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed: $LASTEXITCODE" }
Write-Host "built $outDir\VanceDesktop.exe"
