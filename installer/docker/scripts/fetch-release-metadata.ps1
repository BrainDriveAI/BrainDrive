param()

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

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

$manifestUrl = if ($env:BRAINDRIVE_RELEASE_MANIFEST_URL) { $env:BRAINDRIVE_RELEASE_MANIFEST_URL.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_RELEASE_MANIFEST_URL" }
$signatureUrl = if ($env:BRAINDRIVE_RELEASE_MANIFEST_SIG_URL) { $env:BRAINDRIVE_RELEASE_MANIFEST_SIG_URL.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_RELEASE_MANIFEST_SIG_URL" }
$publicKeyUrl = if ($env:BRAINDRIVE_RELEASE_PUBLIC_KEY_URL) { $env:BRAINDRIVE_RELEASE_PUBLIC_KEY_URL.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_RELEASE_PUBLIC_KEY_URL" }

if (-not $manifestUrl -and -not $signatureUrl -and -not $publicKeyUrl) {
  Write-Host "No remote release metadata URLs configured; skipping fetch."
  exit 0
}

if (-not $manifestUrl -or -not $signatureUrl -or -not $publicKeyUrl) {
  throw "Set BRAINDRIVE_RELEASE_MANIFEST_URL, BRAINDRIVE_RELEASE_MANIFEST_SIG_URL, and BRAINDRIVE_RELEASE_PUBLIC_KEY_URL together."
}

$manifestPath = if ($env:BRAINDRIVE_RELEASE_MANIFEST) { $env:BRAINDRIVE_RELEASE_MANIFEST.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_RELEASE_MANIFEST" }
$signaturePath = if ($env:BRAINDRIVE_RELEASE_MANIFEST_SIG) { $env:BRAINDRIVE_RELEASE_MANIFEST_SIG.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_RELEASE_MANIFEST_SIG" }
$publicKeyPath = if ($env:BRAINDRIVE_RELEASE_PUBLIC_KEY) { $env:BRAINDRIVE_RELEASE_PUBLIC_KEY.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_RELEASE_PUBLIC_KEY" }

if (-not $manifestPath) {
  $manifestPath = "./release-cache/releases.json"
}
if (-not $signaturePath) {
  $signaturePath = "./release-cache/releases.json.sig"
}
if (-not $publicKeyPath) {
  $publicKeyPath = "./release-cache/cosign.pub"
}

$manifestPath = Resolve-PathInRoot -PathValue $manifestPath
$signaturePath = Resolve-PathInRoot -PathValue $signaturePath
$publicKeyPath = Resolve-PathInRoot -PathValue $publicKeyPath

New-Item -ItemType Directory -Path (Split-Path -Parent $manifestPath) -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $signaturePath) -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $publicKeyPath) -Force | Out-Null

Require-Command Invoke-WebRequest

Invoke-WebRequest -Uri $manifestUrl -OutFile $manifestPath
Invoke-WebRequest -Uri $signatureUrl -OutFile $signaturePath
Invoke-WebRequest -Uri $publicKeyUrl -OutFile $publicKeyPath

Write-Host "Fetched release metadata:"
Write-Host "  manifest: $manifestPath"
Write-Host "  signature: $signaturePath"
Write-Host "  public key: $publicKeyPath"
