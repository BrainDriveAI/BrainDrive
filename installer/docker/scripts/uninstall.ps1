param(
  [ValidateSet("prod", "local", "dev")]
  [string]$Mode = "local",
  [switch]$RemoveData,
  [switch]$KeepData,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
if ($RemoveData -and $KeepData) { throw "Choose either -RemoveData or -KeepData, not both." }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
. "$scriptDir/native-command.ps1"
. "$scriptDir/preserved-env.ps1"

$composeFile = "compose.local.yml"
if ($Mode -eq "prod") { $composeFile = "compose.prod.yml" }
elseif ($Mode -eq "dev") { $composeFile = "compose.dev.yml" }

if (-not $RemoveData -and -not $KeepData) {
  $choice = Read-Host "Keep BrainDrive memory, secrets, and settings for a later install? [Y/n]"
  $RemoveData = $choice -match "^(n|no)$"
  $KeepData = -not $RemoveData
}

Write-Host "This removes BrainDrive containers, images, and installer folder: $rootDir"
if ($KeepData) {
  Write-Host "Memory, secrets, and settings volumes will be kept. Installer settings will be saved for a later install."
} else {
  Write-Host "Memory, secrets, settings, and saved installer settings will be removed."
}

if (-not $Yes) {
  $confirmation = Read-Host "Type UNINSTALL to continue"
  if ($confirmation -cne "UNINSTALL") { throw "Uninstall cancelled." }
}

if ($KeepData) { Preserve-BrainDriveEnv -SourcePath (Join-Path $rootDir ".env") }
$arguments = @("compose", "-f", $composeFile, "down", "--remove-orphans", "--rmi", "all")
if ($RemoveData) { $arguments += "--volumes" }
Invoke-CheckedNativeCommand -Command "docker" -Arguments $arguments -FailureMessage "Could not remove BrainDrive containers and images"

if ($RemoveData) { Remove-BrainDrivePersistentEnv }
Set-Location (Split-Path -Parent $rootDir)
Remove-Item -LiteralPath $rootDir -Recurse -Force
Write-Host "BrainDrive $Mode installation removed."
