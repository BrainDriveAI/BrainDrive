param(
  [string]$ManifestPath = ".\releases.json",
  [string]$SignaturePath = ".\releases.json.sig"
)

$ErrorActionPreference = "Stop"

$keyPath = if ($env:COSIGN_KEY_PATH) { $env:COSIGN_KEY_PATH } else { ".\cosign.key" }

if (-not (Test-Path $ManifestPath)) {
  throw "Manifest file not found: $ManifestPath"
}
if (-not (Test-Path $keyPath)) {
  throw "Cosign private key not found: $keyPath. Set COSIGN_KEY_PATH or place cosign.key in current directory."
}
if (-not (Get-Command cosign -ErrorAction SilentlyContinue)) {
  throw "cosign is required to sign manifests."
}

& cosign sign-blob --new-bundle-format=false --use-signing-config=false --tlog-upload=false --key $keyPath --output-signature $SignaturePath $ManifestPath | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Manifest signing failed."
}

Write-Host "Manifest signed: $SignaturePath"
