param(
  [string]$DataDir = "$env:ProgramData\CUSA",
  [string]$Address = "",
  [int]$Port = 1514,
  [int]$EnrollmentPort = 1515
)

$configDir = Join-Path $DataDir "config"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null

if ([string]::IsNullOrWhiteSpace($Address)) {
  exit 0
}

$deploy = @{
  schemaVersion = 1
  source        = "msi"
  deployedAt    = (Get-Date).ToUniversalTime().ToString("o")
  wazuh         = @{
    version = "4.11"
    manager = @{
      address         = $Address.Trim()
      port            = $Port
      enrollmentPort  = $EnrollmentPort
    }
  }
}

$path = Join-Path $configDir "deploy.json"
$deploy | ConvertTo-Json -Depth 6 | Set-Content -Path $path -Encoding UTF8
