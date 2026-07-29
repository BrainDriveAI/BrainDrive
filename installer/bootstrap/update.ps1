param(
  [ValidateSet("prod", "local")]
  [string]$Mode = "local"
)

$ErrorActionPreference = "Stop"

if (-not $PSBoundParameters.ContainsKey("Mode") -and $env:BRAINDRIVE_BOOTSTRAP_MODE) {
  $Mode = $env:BRAINDRIVE_BOOTSTRAP_MODE
}

if ($Mode -notin @("prod", "local")) {
  throw "Usage: update.ps1 [-Mode local|prod]"
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

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

$bootstrapReleaseTagDefault = "26.7.23"
$trustedReleaseKeySha256 = "c92a784b" + "e74b30f8" + "e754e302" + "5a11a7c6" + "9b44d620" + "c8f0e213" + "31b46e17" + "72b179b6"
$repo = if ($env:BRAINDRIVE_BOOTSTRAP_REPO) { $env:BRAINDRIVE_BOOTSTRAP_REPO } else { "BrainDriveAI/BrainDrive" }
$releaseTag = if ($env:BRAINDRIVE_BOOTSTRAP_RELEASE_TAG) { $env:BRAINDRIVE_BOOTSTRAP_RELEASE_TAG } else { $bootstrapReleaseTagDefault }
$installRoot = if ($env:BRAINDRIVE_INSTALL_ROOT) { $env:BRAINDRIVE_INSTALL_ROOT } else { Join-Path $HOME ".braindrive" }
$forceRefresh = Convert-ToBool -Value (if ($env:BRAINDRIVE_BOOTSTRAP_FORCE_REFRESH) { $env:BRAINDRIVE_BOOTSTRAP_FORCE_REFRESH } else { "true" })
$archiveName = if ($env:BRAINDRIVE_BOOTSTRAP_ARCHIVE_NAME) { $env:BRAINDRIVE_BOOTSTRAP_ARCHIVE_NAME } else { "braindrive-installer-$releaseTag.tar.gz" }
$releaseAssetBaseUrl = "https://github.com/$repo/releases/download/$releaseTag"
$archiveUrl = if ($env:BRAINDRIVE_BOOTSTRAP_ARCHIVE_URL) { $env:BRAINDRIVE_BOOTSTRAP_ARCHIVE_URL } else { "$releaseAssetBaseUrl/$archiveName" }
$sha256SumsUrl = if ($env:BRAINDRIVE_BOOTSTRAP_SHA256SUMS_URL) { $env:BRAINDRIVE_BOOTSTRAP_SHA256SUMS_URL } else { "$releaseAssetBaseUrl/SHA256SUMS" }

Require-Command tar
Require-Command docker

$targetDockerDir = Join-Path $installRoot "installer/docker"
$targetUpgradeScript = Join-Path $targetDockerDir "scripts/upgrade.ps1"

function Test-ArchiveChecksum {
  param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][string]$SumsPath
  )

  $checksumMatches = @()
  foreach ($line in Get-Content -LiteralPath $SumsPath) {
    if ($line -match "^([0-9a-fA-F]{64})\s+\*?(.+)$" -and $Matches[2] -eq $archiveName) {
      $checksumMatches += $Matches[1].ToLowerInvariant()
    }
  }

  if ($checksumMatches.Count -ne 1) {
    throw "SHA256SUMS does not contain one valid entry for $archiveName."
  }

  $actualSha256 = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $checksumMatches[0]) {
    throw "Installer archive SHA-256 mismatch. Expected $($checksumMatches[0]); actual $actualSha256."
  }

  Write-Host "Installer archive SHA-256 verified."
}

function Install-FromArchive {
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("braindrive-bootstrap-" + [guid]::NewGuid().ToString("N"))
  $archivePath = Join-Path $tempRoot "source.tar.gz"
  $sumsPath = Join-Path $tempRoot "SHA256SUMS"
  $existingEnv = Join-Path $tempRoot "existing.env"
  $savedEnv = $false

  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  try {
    Write-Host "Downloading installer source: $archiveUrl"
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath
    Invoke-WebRequest -Uri $sha256SumsUrl -OutFile $sumsPath
    Test-ArchiveChecksum -ArchivePath $archivePath -SumsPath $sumsPath
    & tar -xzf $archivePath -C $tempRoot
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to extract installer archive."
    }

    $sourceRoot = Get-ChildItem $tempRoot -Directory | Select-Object -First 1
    if (-not $sourceRoot) {
      throw "Could not find extracted archive root."
    }

    $sourceDockerDir = Join-Path $sourceRoot.FullName "installer/docker"
    if (-not (Test-Path $sourceDockerDir)) {
      throw "Could not find installer/docker in downloaded archive."
    }

    if (Test-Path (Join-Path $targetDockerDir ".env")) {
      Copy-Item (Join-Path $targetDockerDir ".env") $existingEnv -Force
      $savedEnv = $true
    }

    if (Test-Path $targetDockerDir) {
      Remove-Item -LiteralPath $targetDockerDir -Recurse -Force
    }

    $targetInstallerDir = Join-Path $installRoot "installer"
    New-Item -ItemType Directory -Path $targetInstallerDir -Force | Out-Null
    Copy-Item -LiteralPath $sourceDockerDir -Destination $targetInstallerDir -Recurse -Force

    if ($savedEnv -and (Test-Path $existingEnv)) {
      Copy-Item $existingEnv (Join-Path $targetDockerDir ".env") -Force
    }
  } finally {
    if (Test-Path $tempRoot) {
      Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
  }
}

if ((-not (Test-Path $targetUpgradeScript)) -or $forceRefresh) {
  Install-FromArchive
} else {
  Write-Host "Using existing installer at $targetDockerDir"
}

if (-not (Test-Path $targetUpgradeScript)) {
  throw @"
Installer upgrade script not found at $targetUpgradeScript.
Run install first:
  irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/$releaseTag/installer/bootstrap/install.ps1 | iex
"@
}

Write-Host "Running BrainDrive upgrade ($Mode) from $targetDockerDir"
$previousTrustedKeySha256 = $env:BRAINDRIVE_TRUSTED_RELEASE_KEY_SHA256
try {
  $env:BRAINDRIVE_TRUSTED_RELEASE_KEY_SHA256 = $trustedReleaseKeySha256
  & $targetUpgradeScript -Mode $Mode
} finally {
  $env:BRAINDRIVE_TRUSTED_RELEASE_KEY_SHA256 = $previousTrustedKeySha256
}
