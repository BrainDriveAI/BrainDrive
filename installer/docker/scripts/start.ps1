param(
  [ValidateSet("prod", "local")]
  [string]$Mode = "prod"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

$composeFile = if ($Mode -eq "local") { "compose.local.yml" } else { "compose.prod.yml" }
$urlHint = if ($Mode -eq "local") { "http://127.0.0.1:8080" } else { "https://<DOMAIN>" }

if ($Mode -eq "prod") {
  if (-not (Test-Path ".env")) {
    throw "Prod start requires installer/docker/.env with a real DOMAIN. If you meant local mode, run: ./scripts/start.ps1 local"
  }

  $domainLine = Get-Content .env | Where-Object { $_ -match '^DOMAIN=' } | Select-Object -First 1
  $domainValue = if ($domainLine) { ($domainLine.Split("=", 2)[1]).Trim().Trim('"') } else { "" }
  if (-not $domainValue -or $domainValue -eq "app.example.com") {
    throw "Prod start requires installer/docker/.env with a real DOMAIN. If you meant local mode, run: ./scripts/start.ps1 local"
  }
}

try {
  docker compose -f $composeFile up -d
} catch {
  if ($Mode -eq "prod") {
    throw "Prod start failed. If you are running locally, use: ./scripts/start.ps1 local"
  }
  throw
}

docker compose -f $composeFile ps

Write-Host "Start complete. Open: $urlHint"
