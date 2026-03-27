param(
  [ValidateSet("prod", "local")]
  [string]$Mode = "prod"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

$composeFile = if ($Mode -eq "local") { "compose.local.yml" } else { "compose.prod.yml" }

if ($Mode -eq "local") {
  docker compose -f $composeFile up -d --build --remove-orphans
} else {
  docker compose -f $composeFile pull
  docker compose -f $composeFile up -d --remove-orphans
}

docker compose -f $composeFile ps
