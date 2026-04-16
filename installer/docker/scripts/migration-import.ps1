param(
  [Parameter(Mandatory = $true)]
  [string]$ArchiveFile,
  [string]$BaseUrl = "",
  [ValidateSet("dev", "local", "quickstart", "prod")]
  [string]$Mode = "local"
)

$ErrorActionPreference = "Stop"

if ($Mode -eq "quickstart") {
  $Mode = "local"
}

if (-not (Test-Path $ArchiveFile)) {
  throw "Migration archive not found: $ArchiveFile"
}

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  if (-not [string]::IsNullOrWhiteSpace($env:BRAINDRIVE_MIGRATION_BASE_URL)) {
    $BaseUrl = $env:BRAINDRIVE_MIGRATION_BASE_URL
  } elseif ($Mode -eq "dev") {
    $BaseUrl = "http://127.0.0.1:5073"
  } else {
    $BaseUrl = "http://127.0.0.1:8080"
  }
}

$headers = @{
  "content-type" = "application/gzip"
}

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

$resolvedArchive = (Resolve-Path -LiteralPath $ArchiveFile).ProviderPath
$bytes = [System.IO.File]::ReadAllBytes($resolvedArchive)
$response = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/migration/import" -Headers $headers -Body $bytes
$response | ConvertTo-Json -Depth 8
