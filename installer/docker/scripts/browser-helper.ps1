function Get-BrainDriveEnvValue {
  param([Parameter(Mandatory = $true)][string]$Key)

  if (-not (Test-Path ".env")) {
    return ""
  }

  $line = Get-Content .env | Where-Object { $_ -match "^$([regex]::Escape($Key))=" } | Select-Object -First 1
  if (-not $line) {
    return ""
  }

  return ($line.Split("=", 2)[1]).Trim().Trim('"')
}

function Get-BrainDriveUrlHint {
  param([Parameter(Mandatory = $true)][string]$Mode)

  if ($Mode -eq "prod") {
    $domainValue = if ($env:DOMAIN) { $env:DOMAIN.Trim('"') } else { Get-BrainDriveEnvValue -Key "DOMAIN" }
    if ($domainValue -and $domainValue -ne "app.example.com") {
      return "https://$domainValue"
    }
    return "https://<DOMAIN>"
  }

  if ($Mode -eq "dev") {
    $devBindHost = if ($env:BRAINDRIVE_DEV_BIND_HOST) { $env:BRAINDRIVE_DEV_BIND_HOST.Trim('"') } else { Get-BrainDriveEnvValue -Key "BRAINDRIVE_DEV_BIND_HOST" }
    if (-not $devBindHost) {
      $devBindHost = "127.0.0.1"
    }

    $devPort = if ($env:BRAINDRIVE_DEV_PORT) { $env:BRAINDRIVE_DEV_PORT.Trim('"') } else { Get-BrainDriveEnvValue -Key "BRAINDRIVE_DEV_PORT" }
    if (-not $devPort) {
      $devPort = "5073"
    }

    if ($devBindHost -eq "0.0.0.0") {
      return "http://127.0.0.1:$devPort"
    }

    return "http://${devBindHost}:$devPort"
  }

  $localBindHost = if ($env:BRAINDRIVE_LOCAL_BIND_HOST) { $env:BRAINDRIVE_LOCAL_BIND_HOST.Trim('"') } else { Get-BrainDriveEnvValue -Key "BRAINDRIVE_LOCAL_BIND_HOST" }
  if (-not $localBindHost) {
    $localBindHost = "127.0.0.1"
  }

  if ($localBindHost -eq "0.0.0.0") {
    return "http://127.0.0.1:8080"
  }

  return "http://${localBindHost}:8080"
}

function Write-BrainDriveLanHintIfNeeded {
  param([Parameter(Mandatory = $true)][string]$Mode)

  if ($Mode -eq "prod") {
    return
  }

  if ($Mode -eq "dev") {
    $devBindHost = if ($env:BRAINDRIVE_DEV_BIND_HOST) { $env:BRAINDRIVE_DEV_BIND_HOST.Trim('"') } else { Get-BrainDriveEnvValue -Key "BRAINDRIVE_DEV_BIND_HOST" }
    $devPort = if ($env:BRAINDRIVE_DEV_PORT) { $env:BRAINDRIVE_DEV_PORT.Trim('"') } else { Get-BrainDriveEnvValue -Key "BRAINDRIVE_DEV_PORT" }
    if (-not $devPort) {
      $devPort = "5073"
    }

    if ($devBindHost -eq "0.0.0.0") {
      Write-Host "LAN hint: use http://<this-machine-ip>:$devPort from another device."
    }
    return
  }

  $localBindHost = if ($env:BRAINDRIVE_LOCAL_BIND_HOST) { $env:BRAINDRIVE_LOCAL_BIND_HOST.Trim('"') } else { Get-BrainDriveEnvValue -Key "BRAINDRIVE_LOCAL_BIND_HOST" }
  if ($localBindHost -eq "0.0.0.0") {
    Write-Host "LAN hint: use http://<this-machine-ip>:8080 from another device."
  }
}

function Open-BrainDriveUrlInBrowser {
  param([Parameter(Mandatory = $true)][string]$Url)

  if ($Url -match "[<>]") {
    Write-Host "Auto-open skipped because the URL uses a placeholder host."
    return
  }

  $opened = $false

  try {
    if (Get-Command wslview -ErrorAction SilentlyContinue) {
      & wslview $Url *> $null
      $opened = $true
    } else {
      $isWindowsPlatform = $false
      $isMacPlatform = $false
      if ($PSVersionTable.PSVersion.Major -ge 6) {
        $isWindowsPlatform = [bool]$IsWindows
        $isMacPlatform = [bool]$IsMacOS
      } else {
        $isWindowsPlatform = ($env:OS -eq "Windows_NT")
      }

      if ($isWindowsPlatform) {
        Start-Process $Url
        $opened = $true
      } elseif ($isMacPlatform -and (Get-Command open -ErrorAction SilentlyContinue)) {
        & open $Url *> $null
        $opened = $true
      } elseif (Get-Command xdg-open -ErrorAction SilentlyContinue) {
        if ($env:DISPLAY -or $env:WAYLAND_DISPLAY -or $env:WSL_DISTRO_NAME) {
          & xdg-open $Url *> $null
          $opened = $true
        } else {
          Write-Host "Auto-open skipped because no graphical session was detected."
          return
        }
      }
    }
  } catch {
    $opened = $false
  }

  if ($opened) {
    Write-Host "Attempted to open the URL in your default browser."
  } else {
    Write-Host "Auto-open unavailable on this host. Use the URL above in your browser."
  }
}

function Write-BrainDriveAccessInfo {
  param(
    [Parameter(Mandatory = $true)][string]$Mode,
    [string]$Prefix = "BrainDrive is running."
  )

  $urlHint = Get-BrainDriveUrlHint -Mode $Mode
  Write-Host "$Prefix BrainDrive is available at: $urlHint"
  Write-BrainDriveLanHintIfNeeded -Mode $Mode
  Write-Host "If your browser did not open automatically, paste this URL into your browser."
  Open-BrainDriveUrlInBrowser -Url $urlHint
}
