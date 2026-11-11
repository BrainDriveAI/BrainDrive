function Get-BrainDrivePersistentEnvPath {
  $configHome = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $HOME ".config" }
  return Join-Path $configHome "braindrive/installer/docker.env"
}

function Preserve-BrainDriveEnv {
  param([string]$SourcePath)
  if (-not (Test-Path $SourcePath -PathType Leaf)) { return }

  $targetPath = Get-BrainDrivePersistentEnvPath
  if (Test-Path $targetPath) {
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $SourcePath).Hash
    $targetHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $targetPath).Hash
    if ($sourceHash -ne $targetHash) {
      throw "Saved BrainDrive settings already exist and differ; resolve them before uninstalling."
    }
    return
  }

  $targetDirectory = Split-Path -Parent $targetPath
  New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
  [System.IO.File]::Copy($SourcePath, $targetPath, $false)
  if ($env:OS -eq "Windows_NT") {
    $acl = Get-Acl -LiteralPath $targetPath
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($env:USERNAME, "FullControl", "Allow")
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $targetPath -AclObject $acl
  }
}

function Restore-BrainDriveEnv {
  param([string]$TargetPath)
  $sourcePath = Get-BrainDrivePersistentEnvPath
  if ((Test-Path $TargetPath) -or -not (Test-Path $sourcePath -PathType Leaf)) { return }
  $targetDirectory = Split-Path -Parent $TargetPath
  New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
  [System.IO.File]::Copy($sourcePath, $TargetPath, $false)
  Write-Host "Restored saved BrainDrive settings."
  return $true
}

function Remove-BrainDrivePersistentEnv {
  $sourcePath = Get-BrainDrivePersistentEnvPath
  if (Test-Path $sourcePath -PathType Leaf) { Remove-Item -LiteralPath $sourcePath -Force }
}
