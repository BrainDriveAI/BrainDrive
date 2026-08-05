param(
  [ValidateSet("prod", "local", "dev")]
  [string]$Mode = "local"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir
. "$scriptDir/native-command.ps1"

$composeFile = "compose.local.yml"
if ($Mode -eq "prod") {
  $composeFile = "compose.prod.yml"
} elseif ($Mode -eq "dev") {
  $composeFile = "compose.dev.yml"
}

Invoke-CheckedNativeCommand `
  -Command "docker" `
  -Arguments @("compose", "-f", $composeFile, "stop") `
  -FailureMessage "Could not stop the BrainDrive stack"
Invoke-CheckedNativeCommand `
  -Command "docker" `
  -Arguments @("compose", "-f", $composeFile, "ps") `
  -FailureMessage "Could not read the BrainDrive service status"

Write-Host "Stop complete for $Mode stack."
