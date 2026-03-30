param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = "Stop"

$registry = if ($env:REGISTRY) { $env:REGISTRY } else { "ghcr.io/braindrive-ai" }
$appImage = if ($env:APP_IMAGE) { $env:APP_IMAGE } else { "$registry/braindrive-app" }
$edgeImage = if ($env:EDGE_IMAGE) { $env:EDGE_IMAGE } else { "$registry/braindrive-edge" }

docker push "${appImage}:$Version"
docker push "${edgeImage}:$Version"

$appInspect = docker buildx imagetools inspect "${appImage}:$Version"
$edgeInspect = docker buildx imagetools inspect "${edgeImage}:$Version"

$appDigestLine = ($appInspect | Select-String -Pattern "Digest:" | Select-Object -First 1).Line
$edgeDigestLine = ($edgeInspect | Select-String -Pattern "Digest:" | Select-Object -First 1).Line
if (-not $appDigestLine -or -not $edgeDigestLine) {
  throw "Could not resolve image digest(s). Ensure docker buildx is available."
}

$appDigest = $appDigestLine.Split()[-1]
$edgeDigest = $edgeDigestLine.Split()[-1]

Write-Host "APP_REF=${appImage}@${appDigest}"
Write-Host "EDGE_REF=${edgeImage}@${edgeDigest}"
