param(
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [Parameter(Mandatory = $true)]
  [string]$AppRef,
  [Parameter(Mandatory = $true)]
  [string]$EdgeRef,
  [string]$Channel = "stable",
  [string]$Output = ".\releases.json"
)

$ErrorActionPreference = "Stop"

$sigAlgo = if ($env:MANIFEST_SIGNATURE_ALGORITHM) { $env:MANIFEST_SIGNATURE_ALGORITHM } else { "" }
$sigKeyId = if ($env:MANIFEST_SIGNATURE_KEY_ID) { $env:MANIFEST_SIGNATURE_KEY_ID } else { "" }
$sigValue = if ($env:MANIFEST_SIGNATURE_VALUE) { $env:MANIFEST_SIGNATURE_VALUE } else { "" }

$manifest = [ordered]@{
  generated_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  manifest_version = 1
  channels = [ordered]@{ $Channel = $Version }
  releases = [ordered]@{
    $Version = [ordered]@{
      app_image_digest = $AppRef
      edge_image_digest = $EdgeRef
      min_config_version = 1
      max_config_version = 1
      migration_required = $true
      migration_id = "cfg-v1-release-$Version"
    }
  }
  signature = [ordered]@{
    algorithm = $sigAlgo
    key_id = $sigKeyId
    value = $sigValue
  }
}

$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Output -Encoding utf8

if (-not $sigAlgo -or -not $sigValue) {
  Write-Host "Generated unsigned/placeholder manifest at $Output"
  Write-Host "Set MANIFEST_SIGNATURE_ALGORITHM and MANIFEST_SIGNATURE_VALUE for signed output."
} else {
  Write-Host "Generated signed-manifest payload at $Output"
}
