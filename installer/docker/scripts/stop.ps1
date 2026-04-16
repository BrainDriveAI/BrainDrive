param(
  [ValidateSet("quickstart", "prod", "local", "dev")]
  [string]$Mode = "local"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

$quickstartAliasUsed = $false
if ($Mode -eq "quickstart") {
  Write-Warning "Mode 'quickstart' is deprecated and now aliases to 'local'."
  $Mode = "local"
  $quickstartAliasUsed = $true
}

$composeFile = "compose.local.yml"
if ($Mode -eq "prod") {
  $composeFile = "compose.prod.yml"
} elseif ($Mode -eq "dev") {
  $composeFile = "compose.dev.yml"
}

docker compose -f $composeFile stop
if ($quickstartAliasUsed) {
  docker compose -f compose.quickstart.yml stop *> $null
}
docker compose -f $composeFile ps

Write-Host "Stop complete for $Mode stack."
