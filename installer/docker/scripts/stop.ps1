param(
  [ValidateSet("quickstart", "prod", "local")]
  [string]$Mode = "quickstart"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

$composeFile = "compose.quickstart.yml"
if ($Mode -eq "prod") {
  $composeFile = "compose.prod.yml"
} elseif ($Mode -eq "local") {
  $composeFile = "compose.local.yml"
}

docker compose -f $composeFile stop
docker compose -f $composeFile ps

Write-Host "Stop complete for $Mode stack."
