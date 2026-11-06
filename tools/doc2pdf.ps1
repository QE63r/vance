param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$OutDir = ""
)

# .doc / .docx → PDF，走 Word COM。
# 用 ExportAsFixedFormat 而不是 SaveAs：前者参数少、兼容性最好。
$ErrorActionPreference = "Stop"

$src = (Resolve-Path -LiteralPath $Path).Path
if ($OutDir -eq "") { $OutDir = Split-Path -Parent $src }
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$name = [System.IO.Path]::GetFileNameWithoutExtension($src)
$dest = Join-Path $OutDir ($name + ".pdf")

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$word.Options.SaveInterval = 0

$doc = $null
try {
  # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
  $doc = $word.Documents.Open($src, $false, $true, $false)
  # 17 = wdFormatPDF
  $doc.ExportAsFixedFormat($dest, 17)
} finally {
  if ($doc -ne $null) { $doc.Close($false) }
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}

if (Test-Path -LiteralPath $dest) {
  $size = (Get-Item -LiteralPath $dest).Length
  Write-Output ("OK`t" + $dest + "`t" + $size)
} else {
  Write-Output ("FAIL`t" + $dest)
  exit 1
}
