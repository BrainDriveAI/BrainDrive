param(
  [string]$ManifestPath = ".\releases.json",
  [string]$SignaturePath = ".\releases.json.sig",
  [string]$PublicKeyPath = ".\cosign.pub"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ManifestPath)) {
  throw "Manifest file not found: $ManifestPath"
}
if (-not (Test-Path $SignaturePath)) {
  throw "Manifest signature file not found: $SignaturePath"
}
if (-not (Test-Path $PublicKeyPath)) {
  throw "Cosign public key not found: $PublicKeyPath"
}
if (-not (Get-Command cosign -ErrorAction SilentlyContinue)) {
  throw "cosign is required to verify manifests."
}

& cosign verify-blob --new-bundle-format=false --insecure-ignore-tlog=true --key $PublicKeyPath --signature $SignaturePath $ManifestPath | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Manifest signature verification failed."
}

Write-Host "Manifest signature verification passed"
