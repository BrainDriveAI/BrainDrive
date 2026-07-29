function Get-BrainDriveAuthEnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$EnvPath,
    [Parameter(Mandatory = $true)][string]$Key
  )

  $line = Get-Content $EnvPath | Where-Object { $_ -match "^$([regex]::Escape($Key))=" } | Select-Object -First 1
  if (-not $line) {
    return ""
  }

  return ($line.Split("=", 2)[1]).Trim().Trim('"')
}

function Set-BrainDriveAuthEnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$EnvPath,
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $lines = @(Get-Content $EnvPath)
  $updated = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^$([regex]::Escape($Key))=") {
      $lines[$i] = "$Key=$Value"
      $updated = $true
      break
    }
  }

  if (-not $updated) {
    $lines += "$Key=$Value"
  }

  [System.IO.File]::WriteAllText(
    $EnvPath,
    (($lines -join "`n") + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function New-BrainDriveAuthBootstrapToken {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes)
}

function Initialize-BrainDriveProdAuthBootstrap {
  param([string]$EnvPath = ".env")

  if (-not (Test-Path $EnvPath)) {
    throw "Production first-signup protection requires $EnvPath."
  }

  $bootstrapToken = if ($env:PAA_AUTH_BOOTSTRAP_TOKEN) {
    $env:PAA_AUTH_BOOTSTRAP_TOKEN.Trim()
  } else {
    Get-BrainDriveAuthEnvValue -EnvPath $EnvPath -Key "PAA_AUTH_BOOTSTRAP_TOKEN"
  }

  if (-not $bootstrapToken) {
    $bootstrapToken = New-BrainDriveAuthBootstrapToken
    Write-Host "Generated PAA_AUTH_BOOTSTRAP_TOKEN and wrote it to $EnvPath."
  }

  Set-BrainDriveAuthEnvValue -EnvPath $EnvPath -Key "PAA_AUTH_BOOTSTRAP_TOKEN" -Value $bootstrapToken
  Set-BrainDriveAuthEnvValue -EnvPath $EnvPath -Key "PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP" -Value "false"

  $env:PAA_AUTH_BOOTSTRAP_TOKEN = $bootstrapToken
  $env:PAA_AUTH_ALLOW_FIRST_SIGNUP_ANY_IP = "false"
}
