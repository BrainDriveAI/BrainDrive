param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = if ($env:REPO_ROOT) { $env:REPO_ROOT } else { (Resolve-Path (Join-Path $scriptDir "..\..\..")) }
Set-Location $repoRoot

$registry = if ($env:REGISTRY) { $env:REGISTRY } else { "ghcr.io/braindrive-ai" }
$appImage = if ($env:APP_IMAGE) { $env:APP_IMAGE } else { "$registry/braindrive-app" }
$edgeImage = if ($env:EDGE_IMAGE) { $env:EDGE_IMAGE } else { "$registry/braindrive-edge" }

Write-Host "Building ${appImage}:$Version"
docker build -f installer/docker/Dockerfile.app -t "${appImage}:$Version" .

Write-Host "Building ${edgeImage}:$Version"
docker build -f installer/docker/Dockerfile.edge -t "${edgeImage}:$Version" .

Write-Host "Build complete"
