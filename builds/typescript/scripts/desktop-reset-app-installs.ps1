param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$roamingBrainDrive = Join-Path $env:APPDATA "BrainDrive"
$localBrainDrive = Join-Path $env:LOCALAPPDATA "BrainDrive"
$appPlatformRoot = Join-Path $roamingBrainDrive "app-platform"
$backupRoot = Join-Path $appPlatformRoot "reset-backups"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $backupRoot $timestamp

function Normalize-ProcessPath {
  param([AllowNull()][string]$Path)

  if (-not $Path) {
    return ""
  }

  return $Path.Replace("\\?\","")
}

function Test-BrainDriveRuntimeProcess {
  param($Process)

  $name = $Process.Name
  $commandLine = Normalize-ProcessPath -Path $Process.CommandLine
  $executablePath = Normalize-ProcessPath -Path $Process.ExecutablePath

  if ($name -eq "braindrive-desktop.exe") {
    return $true
  }

  if ($executablePath.StartsWith($localBrainDrive, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }

  if ($executablePath.StartsWith($appPlatformRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }

  if ($commandLine -and $commandLine.IndexOf($localBrainDrive, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    return $true
  }

  if ($commandLine -and $commandLine.IndexOf($appPlatformRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    return $true
  }

  return $false
}

if (-not (Test-Path $roamingBrainDrive)) {
  Write-Output "BrainDrive roaming data root was not found: $roamingBrainDrive"
  exit 0
}

Write-Output "Stopping BrainDrive desktop/runtime/app-platform processes."
$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  Test-BrainDriveRuntimeProcess -Process $_
})

foreach ($process in $processes) {
  Write-Output "Stopping $($process.Name) [$($process.ProcessId)]"
  if (-not $DryRun) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

if ((-not $DryRun) -and $processes.Count -gt 0) {
  Start-Sleep -Milliseconds 500
  $survivors = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    Test-BrainDriveRuntimeProcess -Process $_
  })

  foreach ($process in $survivors) {
    Write-Output "Warning: process still running after stop attempt: $($process.Name) [$($process.ProcessId)]"
  }
}

$targets = @(
  @{ Name = "host-app-packages"; Path = (Join-Path $appPlatformRoot "host-app-packages") },
  @{ Name = "host-app-state"; Path = (Join-Path $appPlatformRoot "host-app-state") },
  @{ Name = "runtime"; Path = (Join-Path $appPlatformRoot "runtime") },
  @{ Name = "state\apps"; Path = (Join-Path $appPlatformRoot "state\apps") },
  @{ Name = "state\registry"; Path = (Join-Path $appPlatformRoot "state\registry") },
  @{ Name = "state\migration-evidence"; Path = (Join-Path $appPlatformRoot "state\migration-evidence") },
  @{ Name = "state\packages"; Path = (Join-Path $appPlatformRoot "state\packages") }
)

$existingTargets = $targets | Where-Object { Test-Path $_.Path }
if ($existingTargets.Count -eq 0) {
  Write-Output "No app-platform install/runtime state was present to reset."
  exit 0
}

Write-Output "Backing up app-platform install/runtime state to $backup"
if (-not $DryRun) {
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
}

foreach ($target in $existingTargets) {
  $destination = Join-Path $backup $target.Name
  Write-Output "Moving $($target.Path) -> $destination"
  if (-not $DryRun) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Move-Item -Path $target.Path -Destination $destination -Force
  }
}

Write-Output "Reset complete. Owner app data under $roamingBrainDrive\memory\apps was preserved."
