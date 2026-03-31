param(
  [ValidateSet("quickstart", "prod", "local")]
  [string]$Mode = "quickstart"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

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

  if (-not (Get-Command cosign -ErrorAction SilentlyContinue)) {
    throw "cosign is required for manifest signature verification."
  }

  & cosign verify-blob --new-bundle-format=false --insecure-ignore-tlog=true --key $publicKeyPath --signature $signaturePath $ManifestPath | Out-Null
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

$composeFile = if ($Mode -eq "local") { "compose.local.yml" } elseif ($Mode -eq "prod") { "compose.prod.yml" } else { "compose.quickstart.yml" }

if ($Mode -eq "local") {
  docker compose -f $composeFile up -d --build --remove-orphans
} else {
  & "$scriptDir/fetch-release-metadata.ps1"
  Resolve-ProdImageRefsFromManifest
  Validate-ProdImageRefs
  docker compose -f $composeFile pull
  docker compose -f $composeFile up -d --remove-orphans
}

docker compose -f $composeFile ps
