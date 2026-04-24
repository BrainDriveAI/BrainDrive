param(
  [string]$OutputFile = "",
  [string]$BaseUrl = "",
  [ValidateSet("dev", "local", "prod")]
  [string]$Mode = "local"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  if (-not [string]::IsNullOrWhiteSpace($env:BRAINDRIVE_MIGRATION_BASE_URL)) {
    $BaseUrl = $env:BRAINDRIVE_MIGRATION_BASE_URL
  } elseif ($Mode -eq "dev") {
    $BaseUrl = "http://127.0.0.1:5073"
  } else {
    $BaseUrl = "http://127.0.0.1:8080"
  }
}

if ([string]::IsNullOrWhiteSpace($OutputFile)) {
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $OutputFile = Join-Path $rootDir "backups/memory-migration-$stamp.tar.gz"
}

$outputDir = Split-Path -Parent $OutputFile
if (-not (Test-Path $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$headers = @{}
$accessToken = $env:BRAINDRIVE_MIGRATION_ACCESS_TOKEN
if ([string]::IsNullOrWhiteSpace($accessToken) -and -not [string]::IsNullOrWhiteSpace($env:BRAINDRIVE_MIGRATION_IDENTIFIER) -and -not [string]::IsNullOrWhiteSpace($env:BRAINDRIVE_MIGRATION_PASSWORD)) {
  $loginBody = @{
    identifier = $env:BRAINDRIVE_MIGRATION_IDENTIFIER
    password = $env:BRAINDRIVE_MIGRATION_PASSWORD
  } | ConvertTo-Json -Compress

  $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -ContentType "application/json" -Body $loginBody
  if ($null -eq $login.access_token -or [string]::IsNullOrWhiteSpace([string]$login.access_token)) {
    throw "Login succeeded but access_token was missing."
  }
  $accessToken = [string]$login.access_token
}

if (-not [string]::IsNullOrWhiteSpace($accessToken)) {
  $headers["authorization"] = "Bearer $accessToken"
} else {
  $headers["x-actor-id"] = "owner"
  $headers["x-actor-type"] = "owner"
  $headers["x-auth-mode"] = "local-owner"
  $headers["x-actor-permissions"] = '{"memory_access":true,"tool_access":true,"system_actions":true,"delegation":true,"approval_authority":true,"administration":true}'
}

Invoke-WebRequest -Method Get -Uri "$BaseUrl/api/export" -Headers $headers -OutFile $OutputFile | Out-Null
Write-Host "Migration export saved to $OutputFile"
