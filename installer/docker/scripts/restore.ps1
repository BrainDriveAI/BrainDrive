param(
  [ValidateSet("memory", "secrets")]
  [string]$Target,

  [Parameter(Mandatory = $true)]
  [string]$BackupFile,

  [ValidateSet("quickstart", "prod", "local")]
  [string]$Mode = "prod"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

$composeFile = if ($Mode -eq "quickstart") { "compose.quickstart.yml" } elseif ($Mode -eq "local") { "compose.local.yml" } else { "compose.prod.yml" }
$volumeName = if ($Target -eq "memory") { "braindrive_memory" } else { "braindrive_secrets" }

$resolvedBackupPath = (Resolve-Path $BackupFile).Path
$backupDir = Split-Path -Parent $resolvedBackupPath
$backupName = Split-Path -Leaf $resolvedBackupPath

Write-Host "Stopping stack before restore"
docker compose -f $composeFile down

docker volume create $volumeName | Out-Null

docker run --rm `
  -v "${volumeName}:/volume" `
  -v "${backupDir}:/backup:ro" `
  alpine:3.20 `
  sh -c "rm -rf /volume/* /volume/.[!.]* /volume/..?* 2>/dev/null || true; tar -xzf /backup/${backupName} -C /volume"

Write-Host "Starting stack after restore"
docker compose -f $composeFile up -d

Write-Host "Restore complete for $volumeName from $resolvedBackupPath"
