param(
  [string]$BackupDir = (Join-Path (Get-Location) "backups")
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
$resolvedBackupDir = (Resolve-Path $BackupDir).Path
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"

function Backup-Volume {
  param([string]$VolumeName)

  $fileName = "${VolumeName}_${stamp}.tar.gz"
  docker run --rm `
    -v "${VolumeName}:/volume:ro" `
    -v "${resolvedBackupDir}:/backup" `
    alpine:3.20 `
    sh -c "cd /volume && tar -czf /backup/${fileName} ."

  Write-Host "Created $resolvedBackupDir/$fileName"
}

Backup-Volume -VolumeName "braindrive_memory"
Backup-Volume -VolumeName "braindrive_secrets"

Write-Host "Backup complete: $resolvedBackupDir"
