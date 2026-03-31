param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl
)

$ErrorActionPreference = "Stop"

Invoke-WebRequest -Uri "$BaseUrl/health" -UseBasicParsing | Out-Null
Write-Host "Health check passed for $BaseUrl"
Write-Host "Add auth + message roundtrip checks for production gate completeness."
