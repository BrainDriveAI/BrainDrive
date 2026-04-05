param(
  [ValidateSet("dev", "local", "quickstart", "prod")]
  [string]$Mode = "dev",
  [string]$BaseUrl = ""
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$archive = Join-Path $rootDir "backups/migration-smoke-$stamp.tar.gz"

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  & "$scriptDir/migration-export.ps1" -OutputFile $archive -Mode $Mode | Out-Null
  & "$scriptDir/migration-import.ps1" -ArchiveFile $archive -Mode $Mode | Out-Null
} else {
  & "$scriptDir/migration-export.ps1" -OutputFile $archive -Mode $Mode -BaseUrl $BaseUrl | Out-Null
  & "$scriptDir/migration-import.ps1" -ArchiveFile $archive -Mode $Mode -BaseUrl $BaseUrl | Out-Null
}

Write-Host "Migration smoke test passed: $archive"
