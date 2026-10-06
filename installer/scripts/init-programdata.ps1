param(
  [string]$DataDir = "$env:ProgramData\CUSA"
)

$dirs = @(
  "config", "state", "secrets", "queue\events", "queue\state",
  "queue\commands", "queue\command-results", "logs\agent",
  "logs\installer", "logs\updater", "cache", "updates"
)

foreach ($d in $dirs) {
  New-Item -ItemType Directory -Force -Path (Join-Path $DataDir $d) | Out-Null
}

$marker = Join-Path $DataDir ".install-marker"
Set-Content -Path $marker -Value (Get-Date).ToUniversalTime().ToString("o") -Encoding UTF8

# Restrict secrets to SYSTEM + Administrators
$secrets = Join-Path $DataDir "secrets"
if (Test-Path $secrets) {
  icacls $secrets /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
}
