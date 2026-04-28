param(
  [ValidateSet("prod", "local", "dev")]
  [string]$Mode = "local"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir
. "$scriptDir/browser-helper.ps1"

$composeFile = "compose.local.yml"
if ($Mode -eq "prod") {
  $composeFile = "compose.prod.yml"
} elseif ($Mode -eq "dev") {
  $composeFile = "compose.dev.yml"
}

function Get-EnvValue {
  param([string]$Key)
  if (-not (Test-Path ".env")) {
    return ""
  }

  $line = Get-Content .env | Where-Object { $_ -match "^$([regex]::Escape($Key))=" } | Select-Object -First 1
  if (-not $line) {
    return ""
  }

  return ($line.Split("=", 2)[1]).Trim().Trim('"')
}

if ($Mode -eq "prod") {
  if (-not (Test-Path ".env")) {
    throw "Prod start requires installer/docker/.env with a real DOMAIN. If you meant local mode, run: ./scripts/start.ps1 local"
  }

  $domainValue = Get-EnvValue -Key "DOMAIN"
  if (-not $domainValue -or $domainValue -eq "app.example.com") {
    throw "Prod start requires installer/docker/.env with a real DOMAIN. If you meant local mode, run: ./scripts/start.ps1 local"
  }
}

if ($Mode -eq "prod" -or $Mode -eq "local") {
  & "$scriptDir/check-update.ps1" -Mode $Mode
  $checkUpdateExit = $LASTEXITCODE
  if ($checkUpdateExit -eq 40 -or $checkUpdateExit -eq 50) {
    throw "Startup halted because update policy is fail-closed and update processing failed."
  }
}

if ($Mode -eq "dev") {
  docker volume create braindrive_memory | Out-Null
  docker volume create braindrive_secrets | Out-Null
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

Write-BrainDriveAccessInfo -Mode $Mode -Prefix "Start complete."
