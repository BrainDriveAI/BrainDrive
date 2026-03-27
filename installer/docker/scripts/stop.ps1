param(
  [ValidateSet("prod", "local")]
  [string]$Mode = "prod"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

$composeFile = if ($Mode -eq "local") { "compose.local.yml" } else { "compose.prod.yml" }

docker compose -f $composeFile stop
docker compose -f $composeFile ps

Write-Host "Stop complete for $Mode stack."
