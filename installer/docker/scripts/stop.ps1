param(
  [ValidateSet("prod", "local", "dev")]
  [string]$Mode = "local"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

$composeFile = "compose.local.yml"
if ($Mode -eq "prod") {
  $composeFile = "compose.prod.yml"
} elseif ($Mode -eq "dev") {
  $composeFile = "compose.dev.yml"
}

docker compose -f $composeFile stop
docker compose -f $composeFile ps

Write-Host "Stop complete for $Mode stack."
