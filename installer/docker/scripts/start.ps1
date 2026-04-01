param(
  [ValidateSet("quickstart", "prod", "local")]
  [string]$Mode = "quickstart"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

$composeFile = "compose.quickstart.yml"
$urlHint = "http://127.0.0.1:8080"
if ($Mode -eq "prod") {
  $composeFile = "compose.prod.yml"
  $urlHint = "https://<DOMAIN>"
} elseif ($Mode -eq "local") {
  $composeFile = "compose.local.yml"
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

if ($Mode -eq "local" -or $Mode -eq "quickstart") {
  $localBindHost = Get-EnvValue -Key "BRAINDRIVE_LOCAL_BIND_HOST"
  if (-not $localBindHost) {
    $localBindHost = "127.0.0.1"
  }

  if ($localBindHost -eq "0.0.0.0") {
    $urlHint = "http://<this-machine-ip>:8080"
  } else {
    $urlHint = "http://${localBindHost}:8080"
  }
}

if ($Mode -eq "prod") {
  if (-not (Test-Path ".env")) {
    throw "Prod start requires installer/docker/.env with a real DOMAIN. If you meant quickstart mode, run: ./scripts/start.ps1 quickstart"
  }

  $domainValue = Get-EnvValue -Key "DOMAIN"
  if (-not $domainValue -or $domainValue -eq "app.example.com") {
    throw "Prod start requires installer/docker/.env with a real DOMAIN. If you meant quickstart mode, run: ./scripts/start.ps1 quickstart"
  }
}

if ($Mode -eq "quickstart" -or $Mode -eq "prod") {
  & "$scriptDir/check-update.ps1" -Mode $Mode
  $checkUpdateExit = $LASTEXITCODE
  if ($checkUpdateExit -eq 40 -or $checkUpdateExit -eq 50) {
    throw "Startup halted because update policy is fail-closed and update processing failed."
  }
}

try {
  docker compose -f $composeFile up -d
} catch {
  if ($Mode -eq "prod") {
    throw "Prod start failed. If you are running locally, use: ./scripts/start.ps1 quickstart"
  }
  throw
}

docker compose -f $composeFile ps

Write-Host "Start complete. Open: $urlHint"
