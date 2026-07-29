# SHA-256 fingerprint of BrainDrive's release-manifest signing public key.
$script:BrainDriveEmbeddedReleasePublicKeySha256 = "c92a784b" + "e74b30f8" + "e754e302" + "5a11a7c6" + "9b44d620" + "c8f0e213" + "31b46e17" + "72b179b6"
$script:BrainDriveEmbeddedCosignVersion = "v3.0.6"

function Test-BrainDriveSha256 {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [string]$Label = "File"
  )

  if ($ExpectedSha256 -notmatch "^[0-9a-f]{64}$") {
    throw "$Label has an invalid expected SHA-256: $ExpectedSha256"
  }

  $actualSha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $ExpectedSha256) {
    throw "$Label SHA-256 mismatch. Expected $ExpectedSha256; actual $actualSha256."
  }
}

function Test-BrainDriveReleasePublicKey {
  param([Parameter(Mandatory = $true)][string]$PublicKeyPath)

  if ($env:BRAINDRIVE_TRUSTED_RELEASE_KEY_SHA256 -and
      $env:BRAINDRIVE_TRUSTED_RELEASE_KEY_SHA256 -ne $script:BrainDriveEmbeddedReleasePublicKeySha256) {
    throw "Bootstrap release-key fingerprint does not match the installed trust root."
  }

  Test-BrainDriveSha256 `
    -Path $PublicKeyPath `
    -ExpectedSha256 $script:BrainDriveEmbeddedReleasePublicKeySha256 `
    -Label "Release public key"
}

function Get-BrainDriveCosignSha256 {
  param(
    [Parameter(Mandatory = $true)][string]$Platform,
    [Parameter(Mandatory = $true)][string]$Architecture
  )

  switch ("$Platform-$Architecture") {
    "darwin-amd64" { return "4c3e7af8372d3ca3296e62fa56f23fcbb5721cc6ac1827900d398f110d7cd280" }
    "darwin-arm64" { return "5fadd012ae6381a6a29ff86a7d39aa873878852f1073fc90b15995961ecfb084" }
    "linux-amd64" { return "c956e5dfcac53d52bcf058360d579472f0c1d2d9b69f55209e256fe7783f4c74" }
    "linux-arm64" { return "bedac92e8c3729864e13d4a17048007cfafa79d5deca993a43a90ffe018ef2b8" }
    "windows-amd64" { return "9b85a88ebff2d9dd30ff4984a6f61f2cedc232dd87d81fa7f2ff3c0ed96c241c" }
    default { throw "No embedded cosign checksum for $Platform-$Architecture." }
  }
}
