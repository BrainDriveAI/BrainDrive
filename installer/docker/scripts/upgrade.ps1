param(
  [ValidateSet("prod", "local")]
  [string]$Mode = "local"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir
. "$scriptDir/browser-helper.ps1"
. "$scriptDir/auth-bootstrap.ps1"

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

. "$scriptDir/release-resolution.ps1"

$dryRunRaw = if ($env:BRAINDRIVE_UPGRADE_DRY_RUN) { $env:BRAINDRIVE_UPGRADE_DRY_RUN } else { "false" }
$dryRun = Convert-ToBool -Value $dryRunRaw

function Get-CurrentServiceImage {
  param(
    [Parameter(Mandatory = $true)][string]$ComposeFile,
    [Parameter(Mandatory = $true)][string]$Service
  )

  $containerId = (docker compose -f $ComposeFile ps -q $Service 2>$null | Select-Object -First 1)
  if (-not $containerId) {
    return ""
  }

  $configuredImage = docker inspect --format '{{.Config.Image}}' $containerId 2>$null
  if ($LASTEXITCODE -ne 0) {
    return ""
  }

  return ($configuredImage | Select-Object -First 1).Trim()
}

$composeFile = if ($Mode -eq "prod") { "compose.prod.yml" } else { "compose.local.yml" }

& "$scriptDir/fetch-release-metadata.ps1"
Resolve-ProdImageRefsFromManifest
Validate-ProdImageRefs

$appRef = if ($env:BRAINDRIVE_APP_REF) { $env:BRAINDRIVE_APP_REF.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_APP_REF" }
$edgeRef = if ($env:BRAINDRIVE_EDGE_REF) { $env:BRAINDRIVE_EDGE_REF.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_EDGE_REF" }
$appImage = if ($env:BRAINDRIVE_APP_IMAGE) { $env:BRAINDRIVE_APP_IMAGE.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_APP_IMAGE" }
$edgeImage = if ($env:BRAINDRIVE_EDGE_IMAGE) { $env:BRAINDRIVE_EDGE_IMAGE.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_EDGE_IMAGE" }
$tag = if ($env:BRAINDRIVE_TAG) { $env:BRAINDRIVE_TAG.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_TAG" }

if (-not $tag) {
  $tag = "latest"
}
if (-not $appImage) {
  $appImage = "ghcr.io/braindriveai/braindrive-app"
}
if (-not $edgeImage) {
  $edgeImage = "ghcr.io/braindriveai/braindrive-edge"
}

$targetAppImage = if ($appRef) { $appRef } else { "$appImage`:$tag" }
$targetEdgeImage = if ($edgeRef) { $edgeRef } else { "$edgeImage`:$tag" }

if ($dryRun) {
  $currentAppImage = Get-CurrentServiceImage -ComposeFile $composeFile -Service "app"
  $currentEdgeImage = Get-CurrentServiceImage -ComposeFile $composeFile -Service "edge"

  if (-not $currentAppImage) {
    $currentAppImage = if ($env:BRAINDRIVE_LAST_APPLIED_APP_REF) { $env:BRAINDRIVE_LAST_APPLIED_APP_REF.Trim('"') } else { "" }
  }
  if (-not $currentEdgeImage) {
    $currentEdgeImage = if ($env:BRAINDRIVE_LAST_APPLIED_EDGE_REF) { $env:BRAINDRIVE_LAST_APPLIED_EDGE_REF.Trim('"') } else { "" }
  }

  $updateAvailable = $false
  if (-not $currentAppImage -or -not $currentEdgeImage) {
    $updateAvailable = $true
  } elseif ($currentAppImage -ne $targetAppImage -or $currentEdgeImage -ne $targetEdgeImage) {
    $updateAvailable = $true
  }

  Write-Host "CHECK_MODE=dry-run"
  Write-Host "CHECK_TARGET_APP_REF=$targetAppImage"
  Write-Host "CHECK_TARGET_EDGE_REF=$targetEdgeImage"
  Write-Host "CHECK_CURRENT_APP_REF=$currentAppImage"
  Write-Host "CHECK_CURRENT_EDGE_REF=$currentEdgeImage"
  Write-Host "CHECK_RESOLVED_VERSION=$tag"
  Write-Host "CHECK_UPDATE_AVAILABLE=$($updateAvailable.ToString().ToLowerInvariant())"

  if ($updateAvailable) {
    exit 10
  }
  exit 0
}

if ($Mode -eq "prod") {
  Initialize-BrainDriveProdAuthBootstrap -EnvPath ".env"
}

docker compose -f $composeFile pull
docker compose -f $composeFile up -d --remove-orphans

docker compose -f $composeFile ps
Write-BrainDriveAccessInfo -Mode $Mode -Prefix "Upgrade complete."
