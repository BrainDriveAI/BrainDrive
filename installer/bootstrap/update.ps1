param(
  [ValidateSet("quickstart", "prod", "local")]
  [string]$Mode = "quickstart"
)

$ErrorActionPreference = "Stop"

if (-not $PSBoundParameters.ContainsKey("Mode") -and $env:BRAINDRIVE_BOOTSTRAP_MODE) {
  $Mode = $env:BRAINDRIVE_BOOTSTRAP_MODE
}

if ($Mode -notin @("quickstart", "prod", "local")) {
  throw "Usage: update.ps1 [-Mode quickstart|prod|local]"
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

$repo = if ($env:BRAINDRIVE_BOOTSTRAP_REPO) { $env:BRAINDRIVE_BOOTSTRAP_REPO } else { "BrainDriveAI/BrainDrive" }
$ref = if ($env:BRAINDRIVE_BOOTSTRAP_REF) { $env:BRAINDRIVE_BOOTSTRAP_REF } else { "main" }
$installRoot = if ($env:BRAINDRIVE_INSTALL_ROOT) { $env:BRAINDRIVE_INSTALL_ROOT } else { Join-Path $HOME ".braindrive" }
$forceRefresh = Convert-ToBool -Value (if ($env:BRAINDRIVE_BOOTSTRAP_FORCE_REFRESH) { $env:BRAINDRIVE_BOOTSTRAP_FORCE_REFRESH } else { "true" })
$archiveUrl = if ($env:BRAINDRIVE_BOOTSTRAP_ARCHIVE_URL) { $env:BRAINDRIVE_BOOTSTRAP_ARCHIVE_URL } else { "https://codeload.github.com/$repo/tar.gz/$ref" }

Require-Command tar
Require-Command docker

$targetDockerDir = Join-Path $installRoot "installer/docker"
$targetUpgradeScript = Join-Path $targetDockerDir "scripts/upgrade.ps1"

function Install-FromArchive {
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("braindrive-bootstrap-" + [guid]::NewGuid().ToString("N"))
  $archivePath = Join-Path $tempRoot "source.tar.gz"
  $existingEnv = Join-Path $tempRoot "existing.env"
  $savedEnv = $false

  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  try {
    Write-Host "Downloading installer source: $archiveUrl"
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath
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
  irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/install.ps1 | iex
"@
}

Write-Host "Running BrainDrive upgrade ($Mode) from $targetDockerDir"
& $targetUpgradeScript -Mode $Mode
