param(
  [ValidateSet("quickstart", "prod", "local", "dev")]
  [string]$Mode = "quickstart"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir
. "$scriptDir/browser-helper.ps1"

$composeFile = "compose.quickstart.yml"
if ($Mode -eq "prod") {
  $composeFile = "compose.prod.yml"
} elseif ($Mode -eq "local") {
  $composeFile = "compose.local.yml"
} elseif ($Mode -eq "dev") {
  $composeFile = "compose.dev.yml"
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

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

function Set-EnvValue {
  param(
    [string]$Key,
    [string]$Value
  )

  $lines = @()
  if (Test-Path ".env") {
    $lines = Get-Content .env
  }

  $updated = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^$([regex]::Escape($Key))=") {
      $lines[$i] = "$Key=$Value"
      $updated = $true
      break
    }
  }

  if (-not $updated) {
    $lines += "$Key=$Value"
  }

  [System.IO.File]::WriteAllText((Join-Path $rootDir ".env"), (($lines -join "`n") + "`n"), [System.Text.UTF8Encoding]::new($false))
}

function New-MasterKey {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes)
}

Require-Command docker

try {
  docker compose version | Out-Null
} catch {
  throw "Docker Compose plugin is required (docker compose)."
}

if (Test-Path ".env") {
  throw @"
Install stopped: .env already exists at $rootDir/.env
This installer is first-run only to protect existing account/secrets state.
Use one of these instead:
  - start:   ./scripts/start.ps1 $Mode
  - upgrade: ./scripts/upgrade.ps1 $Mode
  - reset:   ./scripts/reset-new-user.ps1 -FreshClone
"@
}

Copy-Item .env.example .env
Write-Host "Created .env from .env.example"

$masterKey = Get-EnvValue -Key "PAA_SECRETS_MASTER_KEY_B64"
if (-not $masterKey) {
  $masterKey = New-MasterKey
  Set-EnvValue -Key "PAA_SECRETS_MASTER_KEY_B64" -Value $masterKey
  Write-Host "Generated PAA_SECRETS_MASTER_KEY_B64 and wrote it to .env"
}

if ($Mode -eq "prod") {
  $domain = Get-EnvValue -Key "DOMAIN"
  if (-not $domain -or $domain -eq "app.example.com") {
    throw "Please set DOMAIN in .env to your real DNS hostname before prod install."
  }

  $appRef = Get-EnvValue -Key "BRAINDRIVE_APP_REF"
  $edgeRef = Get-EnvValue -Key "BRAINDRIVE_EDGE_REF"
  if ($appRef -and -not $edgeRef) {
    throw "BRAINDRIVE_APP_REF is set but BRAINDRIVE_EDGE_REF is missing. Set both refs or neither."
  }
  if ($edgeRef -and -not $appRef) {
    throw "BRAINDRIVE_EDGE_REF is set but BRAINDRIVE_APP_REF is missing. Set both refs or neither."
  }
}

if ($Mode -eq "dev") {
  docker volume create braindrive_memory | Out-Null
  docker volume create braindrive_secrets | Out-Null
  Write-Host "Building and starting developer stack using $composeFile"
  docker compose -f $composeFile up -d --build
} else {
  Write-Host "Pulling images using $composeFile"
  docker compose -f $composeFile pull
  Write-Host "Starting stack"
  docker compose -f $composeFile up -d
}

Write-Host "Current service status"
docker compose -f $composeFile ps

Write-BrainDriveAccessInfo -Mode $Mode -Prefix "Install complete."
