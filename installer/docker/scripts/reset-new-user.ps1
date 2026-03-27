param(
  [switch]$Yes,
  [switch]$FreshClone
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Missing required command: docker"
}

try {
  docker compose version | Out-Null
} catch {
  throw "Docker Compose plugin is required (docker compose)."
}

$localAppImage = if ($env:BRAINDRIVE_APP_IMAGE_LOCAL) { $env:BRAINDRIVE_APP_IMAGE_LOCAL } else { "braindrive-app:local" }
$localEdgeImage = if ($env:BRAINDRIVE_EDGE_IMAGE_LOCAL) { $env:BRAINDRIVE_EDGE_IMAGE_LOCAL } else { "braindrive-edge:local" }

Write-Host "This will reset LOCAL new-user test state by running:"
Write-Host "  docker compose -f compose.local.yml down -v --remove-orphans"
if ($FreshClone) {
  Write-Host "And also:"
  Write-Host "  remove installer/docker/.env"
  Write-Host "  docker rmi $localAppImage $localEdgeImage (best effort)"
}

if (-not $Yes) {
  $confirmation = Read-Host "Are you sure? Type RESET to continue"
  if ($confirmation -ne "RESET") {
    Write-Host "Reset cancelled."
    exit 0
  }
}

docker compose -f compose.local.yml down -v --remove-orphans | Out-Null

if ($FreshClone) {
  if (Test-Path ".env") {
    Remove-Item -LiteralPath ".env" -Force
  }
  docker rmi $localAppImage $localEdgeImage 2>$null | Out-Null
}

Write-Host "Reset complete."
