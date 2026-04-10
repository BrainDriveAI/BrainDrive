param(
  [ValidateSet("quickstart", "prod", "local")]
  [string]$Mode = "quickstart"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir
. "$scriptDir/browser-helper.ps1"

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

function Convert-ToBool {
  param([string]$Value)

  if (-not $Value) {
    return $false
  }

  switch ($Value.Trim().ToLowerInvariant()) {
    "1" { return $true }
    "true" { return $true }
    "yes" { return $true }
    "on" { return $true }
    default { return $false }
  }
}

$dryRunRaw = if ($env:BRAINDRIVE_UPGRADE_DRY_RUN) { $env:BRAINDRIVE_UPGRADE_DRY_RUN } else { "false" }
$dryRun = Convert-ToBool -Value $dryRunRaw

$script:CosignBin = ""

function Ensure-Cosign {
  if ($script:CosignBin -and (Test-Path $script:CosignBin)) {
    return
  }

  $configuredBin = if ($env:BRAINDRIVE_COSIGN_BIN) { $env:BRAINDRIVE_COSIGN_BIN.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_COSIGN_BIN" }
  if ($configuredBin) {
    if (-not [System.IO.Path]::IsPathRooted($configuredBin)) {
      $configuredBin = Join-Path $rootDir $configuredBin
    }
    if (-not (Test-Path $configuredBin)) {
      throw "Configured BRAINDRIVE_COSIGN_BIN not found: $configuredBin"
    }
    $script:CosignBin = $configuredBin
    return
  }

  $existing = Get-Command cosign -ErrorAction SilentlyContinue
  if ($existing) {
    $script:CosignBin = $existing.Source
    return
  }

  $autoInstallRaw = if ($env:BRAINDRIVE_AUTO_INSTALL_COSIGN) { $env:BRAINDRIVE_AUTO_INSTALL_COSIGN.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_AUTO_INSTALL_COSIGN" }
  if (-not $autoInstallRaw) {
    $autoInstallRaw = "true"
  }
  $autoInstall = Convert-ToBool -Value $autoInstallRaw
  if (-not $autoInstall) {
    throw "cosign is required for manifest signature verification. Install cosign manually or set BRAINDRIVE_AUTO_INSTALL_COSIGN=true."
  }

  $isWindowsPlatform = $false
  $isLinuxPlatform = $false
  $isMacPlatform = $false

  if ($PSVersionTable.PSVersion.Major -ge 6) {
    $isWindowsPlatform = [bool]$IsWindows
    $isLinuxPlatform = [bool]$IsLinux
    $isMacPlatform = [bool]$IsMacOS
  } else {
    $isWindowsPlatform = ($env:OS -eq "Windows_NT")
  }

  if (-not $isWindowsPlatform -and -not $isLinuxPlatform -and -not $isMacPlatform) {
    $osDesc = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription.ToLowerInvariant()
    if ($osDesc -like "*linux*") {
      $isLinuxPlatform = $true
    } elseif ($osDesc -like "*darwin*" -or $osDesc -like "*mac*") {
      $isMacPlatform = $true
    }
  }

  $platform = if ($isWindowsPlatform) { "windows" } elseif ($isLinuxPlatform) { "linux" } elseif ($isMacPlatform) { "darwin" } else { "" }
  if (-not $platform) {
    throw "Automatic cosign install is not supported on this platform. Install cosign manually."
  }

  $archRaw = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  $arch = switch ($archRaw) {
    "x64" { "amd64" }
    "amd64" { "amd64" }
    "arm64" { "arm64" }
    "aarch64" { "arm64" }
    default { "" }
  }
  if (-not $arch) {
    throw "Automatic cosign install is not supported on architecture: $archRaw"
  }

  $version = if ($env:BRAINDRIVE_COSIGN_VERSION) { $env:BRAINDRIVE_COSIGN_VERSION.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_COSIGN_VERSION" }
  $binDir = if ($env:BRAINDRIVE_COSIGN_BIN_DIR) { $env:BRAINDRIVE_COSIGN_BIN_DIR.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_COSIGN_BIN_DIR" }
  if (-not $binDir) {
    if ($isWindowsPlatform) {
      $binDir = Join-Path $HOME ".braindrive/bin"
    } else {
      $binDir = Join-Path $HOME ".local/bin"
    }
  } elseif (-not [System.IO.Path]::IsPathRooted($binDir)) {
    $binDir = Join-Path $rootDir $binDir
  }

  New-Item -ItemType Directory -Path $binDir -Force | Out-Null

  $ext = if ($isWindowsPlatform) { ".exe" } else { "" }
  $target = Join-Path $binDir ("cosign" + $ext)
  $tmpTarget = "$target.tmp"

  $url = if ($version -and $version -ne "latest") {
    "https://github.com/sigstore/cosign/releases/download/$version/cosign-$platform-$arch$ext"
  } else {
    "https://github.com/sigstore/cosign/releases/latest/download/cosign-$platform-$arch$ext"
  }

  Write-Host "cosign not found; downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $tmpTarget

  if (-not $isWindowsPlatform) {
    $chmod = Get-Command chmod -ErrorAction SilentlyContinue
    if ($chmod) {
      & $chmod.Source +x $tmpTarget
    }
  }

  Move-Item -Path $tmpTarget -Destination $target -Force
  $script:CosignBin = $target
}

function Resolve-PathInRoot {
  param([string]$PathValue)

  if (-not $PathValue) {
    return ""
  }

  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return $PathValue
  }

  return Join-Path $rootDir $PathValue
}

function Get-JsonProperty {
  param(
    [Parameter(Mandatory = $true)]
    $Object,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if (-not $Object) {
    return $null
  }

  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop) {
    return $null
  }

  return $prop.Value
}

function Verify-ManifestSignature {
  param([Parameter(Mandatory = $true)][string]$ManifestPath)

  $signaturePath = if ($env:BRAINDRIVE_RELEASE_MANIFEST_SIG) { $env:BRAINDRIVE_RELEASE_MANIFEST_SIG.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_RELEASE_MANIFEST_SIG" }
  $publicKeyPath = if ($env:BRAINDRIVE_RELEASE_PUBLIC_KEY) { $env:BRAINDRIVE_RELEASE_PUBLIC_KEY.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_RELEASE_PUBLIC_KEY" }

  if (-not $signaturePath) {
    $signaturePath = "./release-cache/releases.json.sig"
  }
  if (-not $publicKeyPath) {
    $publicKeyPath = "./release-cache/cosign.pub"
  }

  $signaturePath = Resolve-PathInRoot -PathValue $signaturePath
  $publicKeyPath = Resolve-PathInRoot -PathValue $publicKeyPath

  if (-not (Test-Path $signaturePath)) {
    throw "Manifest signature file not found: $signaturePath"
  }
  if (-not (Test-Path $publicKeyPath)) {
    throw "Manifest public key file not found: $publicKeyPath"
  }

  Ensure-Cosign

  & $script:CosignBin verify-blob --new-bundle-format=false --insecure-ignore-tlog=true --key $publicKeyPath --signature $signaturePath $ManifestPath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Manifest signature verification failed."
  }

  Write-Host "Manifest signature verified with cosign."
}

function Resolve-ProdImageRefsFromManifest {
  $existingAppRef = if ($env:BRAINDRIVE_APP_REF) { $env:BRAINDRIVE_APP_REF.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_APP_REF" }
  $existingEdgeRef = if ($env:BRAINDRIVE_EDGE_REF) { $env:BRAINDRIVE_EDGE_REF.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_EDGE_REF" }

  if ($existingAppRef -and $existingEdgeRef) {
    return
  }

  $manifestPath = if ($env:BRAINDRIVE_RELEASE_MANIFEST) { $env:BRAINDRIVE_RELEASE_MANIFEST.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_RELEASE_MANIFEST" }
  $manifestPathIsExplicit = $true
  if (-not $manifestPath) {
    $manifestPath = "./release-cache/releases.json"
    $manifestPathIsExplicit = $false
  }

  if (-not [System.IO.Path]::IsPathRooted($manifestPath)) {
    $manifestPath = Join-Path $rootDir $manifestPath
  }

  if (-not (Test-Path $manifestPath)) {
    if (-not $manifestPathIsExplicit) {
      return
    }
    throw "Release manifest file not found: $manifestPath"
  }

  $channel = if ($env:BRAINDRIVE_RELEASE_CHANNEL) { $env:BRAINDRIVE_RELEASE_CHANNEL.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_RELEASE_CHANNEL" }
  if (-not $channel) {
    $channel = "stable"
  }

  $versionOverride = if ($env:BRAINDRIVE_RELEASE_VERSION) { $env:BRAINDRIVE_RELEASE_VERSION.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_RELEASE_VERSION" }

  $requireSigRaw = if ($env:BRAINDRIVE_REQUIRE_MANIFEST_SIGNATURE) { $env:BRAINDRIVE_REQUIRE_MANIFEST_SIGNATURE.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_REQUIRE_MANIFEST_SIGNATURE" }
  if (-not $requireSigRaw) {
    $requireSigRaw = "true"
  }
  $requireSignature = Convert-ToBool -Value $requireSigRaw

  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

  if ($requireSignature) {
    Verify-ManifestSignature -ManifestPath $manifestPath
  }

  $resolvedVersion = if ($versionOverride) { $versionOverride } else { Get-JsonProperty -Object $manifest.channels -Name $channel }
  if (-not $resolvedVersion) {
    throw "Could not resolve release version for channel: $channel"
  }

  $release = Get-JsonProperty -Object $manifest.releases -Name $resolvedVersion
  if (-not $release) {
    throw "Release entry not found: $resolvedVersion"
  }

  $appRef = if ($release.app_image_digest) { $release.app_image_digest } elseif ($release.app_image_ref) { $release.app_image_ref } else { "" }
  $edgeRef = if ($release.edge_image_digest) { $release.edge_image_digest } elseif ($release.edge_image_ref) { $release.edge_image_ref } else { "" }

  if (-not $appRef -or -not $edgeRef) {
    throw "Release $resolvedVersion is missing app/edge digest refs"
  }

  $env:BRAINDRIVE_APP_REF = $appRef
  $env:BRAINDRIVE_EDGE_REF = $edgeRef
  $env:BRAINDRIVE_TAG = $resolvedVersion

  Write-Host "Resolved release refs from manifest ($resolvedVersion)"
}

function Validate-ProdImageRefs {
  $appRef = if ($env:BRAINDRIVE_APP_REF) { $env:BRAINDRIVE_APP_REF.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_APP_REF" }
  $edgeRef = if ($env:BRAINDRIVE_EDGE_REF) { $env:BRAINDRIVE_EDGE_REF.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_EDGE_REF" }

  if ($appRef -and -not $edgeRef) {
    throw "BRAINDRIVE_APP_REF is set but BRAINDRIVE_EDGE_REF is missing. Set both refs or neither."
  }

  if ($edgeRef -and -not $appRef) {
    throw "BRAINDRIVE_EDGE_REF is set but BRAINDRIVE_APP_REF is missing. Set both refs or neither."
  }

  if ($appRef -and $edgeRef) {
    Write-Host "Using digest/image refs from BRAINDRIVE_APP_REF and BRAINDRIVE_EDGE_REF."
  } else {
    Write-Host "Using BRAINDRIVE_APP_IMAGE/BRAINDRIVE_EDGE_IMAGE with BRAINDRIVE_TAG."
  }
}

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

$composeFile = if ($Mode -eq "local") { "compose.local.yml" } elseif ($Mode -eq "prod") { "compose.prod.yml" } else { "compose.quickstart.yml" }

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

docker compose -f $composeFile pull
docker compose -f $composeFile up -d --remove-orphans

docker compose -f $composeFile ps
Write-BrainDriveAccessInfo -Mode $Mode -Prefix "Upgrade complete."
