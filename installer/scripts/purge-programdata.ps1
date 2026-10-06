param(
  [string]$DataDir = "$env:ProgramData\CUSA"
)

if (-not (Test-Path $DataDir)) { exit 0 }

$targets = @("config", "state", "secrets", "queue", "cache", "updates", ".install-marker")
foreach ($name in $targets) {
  $path = Join-Path $DataDir $name
  if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Logs preserved unless enterprise policy deletes entire CUSA folder separately
