param(
  [ValidateSet("prod", "local", "dev")]
  [string]$Mode = "local"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir
. "$scriptDir/browser-helper.ps1"
. "$scriptDir/auth-bootstrap.ps1"
. "$scriptDir/native-command.ps1"

$composeFile = "compose.local.yml"
if ($Mode -eq "prod") {
  $composeFile = "compose.prod.yml"
} elseif ($Mode -eq "dev") {
  $composeFile = "compose.dev.yml"
}
$generatedDir = Join-Path $rootDir ".generated"
$sidecarComposeFile = Join-Path $generatedDir "package-sidecars.$Mode.yml"
$sidecarDescriptorFile = Join-Path $generatedDir "package-sidecars.$Mode.json"

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

  Initialize-BrainDriveProdAuthBootstrap -EnvPath ".env"

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
  Invoke-CheckedNativeCommand `
    -Command "docker" `
    -Arguments @("volume", "create", "braindrive_memory") `
    -FailureMessage "Could not create the BrainDrive memory volume" | Out-Null
  Invoke-CheckedNativeCommand `
    -Command "docker" `
    -Arguments @("volume", "create", "braindrive_secrets") `
    -FailureMessage "Could not create the BrainDrive secrets volume" | Out-Null
}

$composeArguments = @("compose", "-f", $composeFile)
if ($Mode -eq "dev" -or $Mode -eq "local") {
  Invoke-CheckedNativeCommand `
    -Command "node" `
    -Arguments @("$scriptDir/render-package-sidecars.mjs", "--mode", $Mode, "--out", $sidecarComposeFile, "--descriptors", $sidecarDescriptorFile) `
    -FailureMessage "Could not render package-declared Docker sidecars"
  $composeArguments += @("-f", $sidecarComposeFile)
}

try {
  Invoke-CheckedNativeCommand `
    -Command "docker" `
    -Arguments ($composeArguments + @("up", "-d")) `
    -FailureMessage "Could not start the BrainDrive stack"
} catch {
  if ($Mode -eq "prod") {
    throw "Prod start failed. If you are running locally, use: ./scripts/start.ps1 local"
  }
  throw
}

Invoke-CheckedNativeCommand `
  -Command "docker" `
  -Arguments ($composeArguments + @("ps")) `
  -FailureMessage "Could not read the BrainDrive service status"

Write-BrainDriveAccessInfo -Mode $Mode -Prefix "Start complete."
