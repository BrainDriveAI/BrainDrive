param(
  [string]$LibraryPath,
  [string]$SecretsPath,
  [string]$MemoryRoot = "./your-memory",
  [string]$MasterKeyB64,
  [string]$MasterKeyId = "owner-master-v1",
  [switch]$SkipDocker,
  [switch]$StartCli
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message)
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function New-MasterKeyB64 {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes)
}

function Escape-EnvValue {
  param([string]$Value)
  return $Value.Replace('\', '\\').Replace('"', '\"')
}

function Upsert-EnvFile {
  param(
    [string]$EnvFilePath,
    [hashtable]$Entries
  )

  $existingLines = @()
  if (Test-Path $EnvFilePath) {
    Copy-Item $EnvFilePath "$EnvFilePath.bak.$((Get-Date).ToString('yyyyMMddHHmmss'))"
    $existingLines = Get-Content $EnvFilePath -ErrorAction SilentlyContinue
  }

  $keys = $Entries.Keys
  $filtered = @()
  foreach ($line in $existingLines) {
    $keep = $true
    foreach ($key in $keys) {
      if ($line -match ("^{0}=" -f [regex]::Escape($key))) {
        $keep = $false
        break
      }
    }
    if ($keep) {
      $filtered += $line
    }
  }

  foreach ($key in $keys) {
    $value = Escape-EnvValue -Value ([string]$Entries[$key])
    $filtered += ('{0}="{1}"' -f $key, $value)
  }

  $content = ($filtered -join "`n") + "`n"
  [System.IO.File]::WriteAllText($EnvFilePath, $content, [System.Text.UTF8Encoding]::new($false))
}

function Import-EnvFile {
  param([string]$EnvFilePath)
  foreach ($line in Get-Content $EnvFilePath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }
    $index = $trimmed.IndexOf('=')
    if ($index -lt 1) {
      continue
    }
    $name = $trimmed.Substring(0, $index)
    $rawValue = $trimmed.Substring($index + 1).Trim()
    if ($rawValue.StartsWith('"') -and $rawValue.EndsWith('"')) {
      $rawValue = $rawValue.Substring(1, $rawValue.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $rawValue, "Process")
  }
}

function Wait-RuntimeHealth {
  param(
    [int]$Attempts = 60,
    [int]$DelaySeconds = 2
  )

  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      $response = Invoke-RestMethod -Uri "http://127.0.0.1:8787/health" -Method Get -TimeoutSec 2
      if ($response.status -eq "ok") {
        return $true
      }
    } catch {
      Start-Sleep -Seconds $DelaySeconds
    }
  }
  return $false
}

function Resolve-AbsolutePath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathValue
  )
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }

  return [System.IO.Path]::GetFullPath((Join-Path $rootDir $PathValue))
}

Require-Command -Name "node"
Require-Command -Name "npm"
Require-Command -Name "docker"

$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location $rootDir

if (-not $LibraryPath) {
  $LibraryPath = Join-Path $rootDir "your-memory"
}
if (-not $SecretsPath) {
  $SecretsPath = Join-Path $HOME ".config/paa/secrets"
}
if (-not $MasterKeyB64) {
  if ($env:PAA_SECRETS_MASTER_KEY_B64) {
    $MasterKeyB64 = $env:PAA_SECRETS_MASTER_KEY_B64
  } else {
    $MasterKeyB64 = New-MasterKeyB64
    Write-Host "Generated new master key for this setup run."
  }
}

Write-Step "Preparing directories and .env"
New-Item -ItemType Directory -Path $LibraryPath -Force | Out-Null
New-Item -ItemType Directory -Path $SecretsPath -Force | Out-Null

$envFile = Join-Path $rootDir ".env"
Upsert-EnvFile -EnvFilePath $envFile -Entries @{
  PAA_LIBRARY_HOST_PATH      = $LibraryPath
  PAA_SECRETS_HOST_PATH      = $SecretsPath
  PAA_MEMORY_ROOT            = $MemoryRoot
  PAA_SECRETS_MASTER_KEY_B64 = $MasterKeyB64
  PAA_SECRETS_MASTER_KEY_ID  = $MasterKeyId
}
Import-EnvFile -EnvFilePath $envFile

Write-Step "Installing npm dependencies"
& npm install

Write-Step "Initializing secrets key material"
& npm run secrets -- init

Write-Step "Setting OpenRouter API key in encrypted vault"
Write-Host "Paste your OpenRouter API key when prompted."
& npm run secrets -- set provider/openrouter/api_key

Write-Step "Initializing memory layout (secret_ref profile)"
$initMemoryRoot = Resolve-AbsolutePath -PathValue $MemoryRoot
$initLibraryRoot = Resolve-AbsolutePath -PathValue $LibraryPath
& npm run memory:init -- --memory-root $initMemoryRoot --profile openrouter-secret-ref --seed-default-projects
if ($initLibraryRoot -ne $initMemoryRoot) {
  & npm run memory:init -- --memory-root $initLibraryRoot --profile openrouter-secret-ref --seed-default-projects
}

Write-Step "Checking secrets status"
& npm run secrets -- status

if (-not $SkipDocker) {
  Write-Step "Starting Docker stack"
  & docker compose down
  & docker compose up -d --build

  Write-Step "Waiting for runtime health"
  if (-not (Wait-RuntimeHealth)) {
    Write-Host "Runtime did not become healthy. Showing recent logs..." -ForegroundColor Red
    $runtimeContainerId = (& docker compose ps -q paa-runtime 2>$null | Select-Object -First 1)
    if ($runtimeContainerId) {
      & docker logs --tail 120 $runtimeContainerId
    } else {
      & docker compose logs --tail 120 paa-runtime
    }
    throw "Runtime health check failed"
  }
}

Write-Step "Setup complete"
Write-Host "Next command: npm run dev:cli"
Write-Host "Then prompt: Tell me a joke"

if ($StartCli) {
  & npm run dev:cli
}
