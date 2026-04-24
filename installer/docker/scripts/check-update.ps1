param(
  [ValidateSet("prod", "local")]
  [string]$Mode = "local"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

$stateFallbackPath = Join-Path $rootDir "release-cache/startup-update-state.json"
$configVolumePath = "/data/memory/system/config/app-config.json"
$stateVolumePath = "/data/memory/system/updates/state.json"
$memoryVolume = "braindrive_memory"
$runtimeDir = Join-Path $rootDir ".runtime"
$lockPath = Join-Path $runtimeDir "check-update.lock"

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
if (Test-Path $lockPath) {
  Write-Host "Startup update check skipped: another check is already running."
  exit 0
}
New-Item -ItemType Directory -Path $lockPath | Out-Null

try {
  function Get-EnvValue {
    param([string]$Key)
    if (-not (Test-Path ".env")) {
      return ""
    }

    $line = Get-Content .env | Where-Object { $_ -match "^$([regex]::Escape($Key))=" } | Select-Object -First 1
    if (-not $line) {
      return ""
    }

    return ($line.Split("=", 2)[1]).Trim().Trim('"')
  }

  function Convert-ToBool {
    param([string]$Value)

    if (-not $Value) {
      return $false
    }

    switch ($Value.Trim().ToLowerInvariant()) {
      "1" { return $true }
      "true" { return $true }
      "yes" { return $true }
      "on" { return $true }
      default { return $false }
    }
  }

  function Resolve-Setting {
    param(
      [string]$RuntimeValue,
      [string]$ConfigValue,
      [string]$EnvFileValue,
      [string]$DefaultValue
    )

    if ($RuntimeValue) {
      return $RuntimeValue
    }
    if ($ConfigValue) {
      return $ConfigValue
    }
    if ($EnvFileValue) {
      return $EnvFileValue
    }
    return $DefaultValue
  }

  function Get-HelperImage {
    $appRef = if ($env:BRAINDRIVE_APP_REF) { $env:BRAINDRIVE_APP_REF.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_APP_REF" }
    if ($appRef) {
      return $appRef
    }

    $appImage = if ($env:BRAINDRIVE_APP_IMAGE) { $env:BRAINDRIVE_APP_IMAGE.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_APP_IMAGE" }
    $tag = if ($env:BRAINDRIVE_TAG) { $env:BRAINDRIVE_TAG.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_TAG" }

    if (-not $appImage) {
      $appImage = "ghcr.io/braindriveai/braindrive-app"
    }
    if (-not $tag) {
      $tag = "latest"
    }

    return "$appImage`:$tag"
  }

  function Read-VolumeFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
      return ""
    }

    docker volume inspect $memoryVolume *> $null
    if ($LASTEXITCODE -ne 0) {
      return ""
    }

    $helperImage = Get-HelperImage
    $content = docker run --rm -v "${memoryVolume}:/data/memory" --entrypoint /bin/sh $helperImage -lc "cat '$Path' 2>/dev/null" 2>$null
    if ($LASTEXITCODE -ne 0) {
      return ""
    }

    return (($content | Out-String).TrimEnd())
  }

  function Write-VolumeFile {
    param(
      [Parameter(Mandatory = $true)][string]$Path,
      [Parameter(Mandatory = $true)][string]$Content
    )

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
      return $false
    }

    docker volume inspect $memoryVolume *> $null
    if ($LASTEXITCODE -ne 0) {
      return $false
    }

    $helperImage = Get-HelperImage
    $null = $Content | docker run --rm -i -v "${memoryVolume}:/data/memory" -e "TARGET_PATH=$Path" --entrypoint /bin/sh $helperImage -lc 'mkdir -p "$(dirname "$TARGET_PATH")" && cat > "$TARGET_PATH"'
    return ($LASTEXITCODE -eq 0)
  }

  function Parse-Config {
    param([string]$JsonText)

    if (-not $JsonText) {
      return @{}
    }

    try {
      $doc = $JsonText | ConvertFrom-Json -ErrorAction Stop
    } catch {
      return @{}
    }

    $updates = $doc.updates
    if (-not $updates) {
      return @{}
    }

    $windowed = $updates.windowed_apply

    $result = @{}
    if ($null -ne $updates.enabled) { $result.enabled = [string]$updates.enabled }
    if ($null -ne $updates.startup_check) { $result.startup_check = [string]$updates.startup_check }
    if ($updates.policy) { $result.policy = [string]$updates.policy }
    if ($updates.fail_mode) { $result.fail_mode = [string]$updates.fail_mode }
    if ($null -ne $updates.min_check_interval_minutes) { $result.min_check_interval_minutes = [string]$updates.min_check_interval_minutes }

    if ($windowed) {
      if ($null -ne $windowed.enabled) { $result.window_enabled = [string]$windowed.enabled }
      if ($windowed.timezone) { $result.window_timezone = [string]$windowed.timezone }
      if ($windowed.days) { $result.window_days = (($windowed.days | ForEach-Object { [string]$_ }) -join ",") }
      if ($windowed.start_time) { $result.window_start = [string]$windowed.start_time }
      if ($windowed.end_time) { $result.window_end = [string]$windowed.end_time }
    }

    return $result
  }

  function Ensure-ConfigDefaults {
    param(
      [string]$ExistingJson,
      [hashtable]$Defaults
    )

    function Ensure-Property {
      param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)]$Value
      )

      if ($null -eq $Object.PSObject.Properties[$Name]) {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
        return $true
      }
      return $false
    }

    $changed = $false

    $doc = $null
    if ($ExistingJson) {
      try {
        $doc = $ExistingJson | ConvertFrom-Json -ErrorAction Stop
      } catch {
        $doc = $null
      }
    }
    if (-not $doc) {
      $doc = [pscustomobject]@{}
      $changed = $true
    }

    $updates = $null
    $updatesProp = $doc.PSObject.Properties["updates"]
    if ($updatesProp) {
      $updates = $updatesProp.Value
    }
    if (-not ($updates -is [pscustomobject])) {
      $updates = [pscustomobject]@{}
      if ($updatesProp) {
        $doc.updates = $updates
      } else {
        $doc | Add-Member -NotePropertyName updates -NotePropertyValue $updates
      }
      $changed = $true
    }

    if (Ensure-Property -Object $updates -Name "enabled" -Value ([bool]$Defaults.enabled)) { $changed = $true }
    if (Ensure-Property -Object $updates -Name "startup_check" -Value ([bool]$Defaults.startup_check)) { $changed = $true }
    if (Ensure-Property -Object $updates -Name "policy" -Value ([string]$Defaults.policy)) { $changed = $true }
    if (Ensure-Property -Object $updates -Name "fail_mode" -Value ([string]$Defaults.fail_mode)) { $changed = $true }
    if (Ensure-Property -Object $updates -Name "min_check_interval_minutes" -Value ([int]$Defaults.min_check_interval_minutes)) { $changed = $true }

    $windowed = $null
    $windowedProp = $updates.PSObject.Properties["windowed_apply"]
    if ($windowedProp) {
      $windowed = $windowedProp.Value
    }
    if (-not ($windowed -is [pscustomobject])) {
      $windowed = [pscustomobject]@{}
      if ($windowedProp) {
        $updates.windowed_apply = $windowed
      } else {
        $updates | Add-Member -NotePropertyName windowed_apply -NotePropertyValue $windowed
      }
      $changed = $true
    }

    if (Ensure-Property -Object $windowed -Name "enabled" -Value ([bool]$Defaults.window_enabled)) { $changed = $true }
    if (Ensure-Property -Object $windowed -Name "timezone" -Value ([string]$Defaults.window_timezone)) { $changed = $true }
    if (Ensure-Property -Object $windowed -Name "days" -Value ([string[]]$Defaults.window_days)) { $changed = $true }
    if (Ensure-Property -Object $windowed -Name "start_time" -Value ([string]$Defaults.window_start)) { $changed = $true }
    if (Ensure-Property -Object $windowed -Name "end_time" -Value ([string]$Defaults.window_end)) { $changed = $true }

    return @{
      Changed = $changed
      Json = ($doc | ConvertTo-Json -Depth 12)
    }
  }

  function Parse-State {
    param([string]$JsonText)

    $result = @{
      last_checked_at = ""
      last_check_status = ""
      last_check_error = ""
      last_available_version = ""
      last_applied_version = ""
      last_applied_app_ref = ""
      last_applied_edge_ref = ""
      pending_update = "false"
      pending_reason = ""
      consecutive_failures = "0"
      next_retry_at = ""
    }

    if (-not $JsonText) {
      return $result
    }

    try {
      $doc = $JsonText | ConvertFrom-Json -ErrorAction Stop
    } catch {
      return $result
    }

    foreach ($k in $result.Keys) {
      $prop = $doc.PSObject.Properties[$k]
      if ($null -ne $prop -and $null -ne $prop.Value) {
        if ($prop.Value -is [bool]) {
          $result[$k] = if ($prop.Value) { "true" } else { "false" }
        } else {
          $result[$k] = [string]$prop.Value
        }
      }
    }

    return $result
  }

  function Test-IntervalGate {
    param(
      [string]$LastCheckedAt,
      [string]$NextRetryAt,
      [int]$MinCheckIntervalMinutes
    )

    $now = [DateTimeOffset]::UtcNow

    if ($NextRetryAt) {
      $nextRetry = $null
      if ([DateTimeOffset]::TryParse($NextRetryAt, [ref]$nextRetry)) {
        if ($now -lt $nextRetry.ToUniversalTime()) {
          return @{ check = $false; reason = "backoff" }
        }
      }
    }

    if ($LastCheckedAt -and $MinCheckIntervalMinutes -gt 0) {
      $lastChecked = $null
      if ([DateTimeOffset]::TryParse($LastCheckedAt, [ref]$lastChecked)) {
        $elapsed = $now - $lastChecked.ToUniversalTime()
        if ($elapsed.TotalMinutes -lt $MinCheckIntervalMinutes) {
          return @{ check = $false; reason = "min-interval" }
        }
      }
    }

    return @{ check = $true; reason = "ok" }
  }

  function Test-WindowAllowsApply {
    param(
      [bool]$Enabled,
      [string]$Timezone,
      [string]$Days,
      [string]$StartTime,
      [string]$EndTime
    )

    if (-not $Enabled) {
      return @{ allow = $false; reason = "disabled" }
    }

    if (-not $StartTime -or -not $EndTime) {
      return @{ allow = $false; reason = "missing-time" }
    }

    $nowUtc = [DateTimeOffset]::UtcNow
    $localNow = $nowUtc

    if ($Timezone) {
      try {
        $tzInfo = [TimeZoneInfo]::FindSystemTimeZoneById($Timezone)
        $localNow = [TimeZoneInfo]::ConvertTime($nowUtc, $tzInfo)
      } catch {
        $localNow = $nowUtc
      }
    }

    $dayList = @()
    if ($Days) {
      $dayList = $Days.Split(",") | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ }
    }

    if ($dayList.Count -gt 0) {
      $today = $localNow.DayOfWeek.ToString().ToLowerInvariant()
      if ($dayList -notcontains $today) {
        return @{ allow = $false; reason = "day" }
      }
    }

    $start = [TimeSpan]::Zero
    $end = [TimeSpan]::Zero
    if (-not [TimeSpan]::TryParse($StartTime, [ref]$start)) {
      return @{ allow = $false; reason = "bad-time" }
    }
    if (-not [TimeSpan]::TryParse($EndTime, [ref]$end)) {
      return @{ allow = $false; reason = "bad-time" }
    }

    $nowTime = $localNow.TimeOfDay
    if ($nowTime -ge $start -and $nowTime -le $end) {
      return @{ allow = $true; reason = "ok" }
    }

    return @{ allow = $false; reason = "outside-window" }
  }

  function Get-NextRetryIso {
    param([int]$Failures)

    $safeFailures = [Math]::Max(1, $Failures)
    $minutes = [Math]::Min(60, 15 * [Math]::Pow(2, $safeFailures - 1))
    $next = [DateTimeOffset]::UtcNow.AddMinutes([int][Math]::Round($minutes))
    return $next.ToString("yyyy-MM-ddTHH:mm:ssZ")
  }

  function Write-State {
    param(
      [string]$Status,
      [string]$ErrorMessage,
      [bool]$PendingUpdate,
      [string]$PendingReason,
      [string]$AvailableVersion,
      [string]$AppliedVersion,
      [string]$AppliedAppRef,
      [string]$AppliedEdgeRef,
      [int]$ConsecutiveFailures,
      [string]$NextRetryAt
    )

    $doc = [ordered]@{
      last_checked_at = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
      last_check_status = $Status
      last_check_error = if ($ErrorMessage) { $ErrorMessage } else { $null }
      last_available_version = if ($AvailableVersion) { $AvailableVersion } else { $null }
      last_applied_version = if ($AppliedVersion) { $AppliedVersion } else { $null }
      last_applied_app_ref = if ($AppliedAppRef) { $AppliedAppRef } else { $null }
      last_applied_edge_ref = if ($AppliedEdgeRef) { $AppliedEdgeRef } else { $null }
      pending_update = $PendingUpdate
      pending_reason = if ($PendingReason) { $PendingReason } else { $null }
      consecutive_failures = $ConsecutiveFailures
      next_retry_at = if ($NextRetryAt) { $NextRetryAt } else { $null }
    }

    $payload = $doc | ConvertTo-Json -Depth 5

    if (-not (Write-VolumeFile -Path $stateVolumePath -Content $payload)) {
      $fallbackDir = Split-Path -Parent $stateFallbackPath
      New-Item -ItemType Directory -Path $fallbackDir -Force | Out-Null
      Set-Content -Path $stateFallbackPath -Value $payload -Encoding UTF8
    }
  }

  function Parse-CheckOutput {
    param([string[]]$Lines)

    $map = @{}
    foreach ($line in $Lines) {
      if ($line -match '^([A-Z0-9_]+)=(.*)$') {
        $map[$matches[1]] = $matches[2]
      }
    }
    return $map
  }

  $configJson = Read-VolumeFile -Path $configVolumePath

  $seedUpdatesEnabledRaw = if ($env:BRAINDRIVE_UPDATES_ENABLED) { $env:BRAINDRIVE_UPDATES_ENABLED.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_UPDATES_ENABLED" }
  if (-not $seedUpdatesEnabledRaw) { $seedUpdatesEnabledRaw = "true" }
  $seedStartupCheckRaw = if ($env:BRAINDRIVE_STARTUP_UPDATE_CHECK) { $env:BRAINDRIVE_STARTUP_UPDATE_CHECK.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_STARTUP_UPDATE_CHECK" }
  if (-not $seedStartupCheckRaw) { $seedStartupCheckRaw = "true" }
  $seedPolicy = if ($env:BRAINDRIVE_UPDATES_POLICY) { $env:BRAINDRIVE_UPDATES_POLICY.Trim('"').ToLowerInvariant() } else { (Get-EnvValue -Key "BRAINDRIVE_UPDATES_POLICY").ToLowerInvariant() }
  if (-not $seedPolicy) { $seedPolicy = "auto-apply" }
  $seedFailMode = if ($env:BRAINDRIVE_UPDATES_FAIL_MODE) { $env:BRAINDRIVE_UPDATES_FAIL_MODE.Trim('"').ToLowerInvariant() } else { (Get-EnvValue -Key "BRAINDRIVE_UPDATES_FAIL_MODE").ToLowerInvariant() }
  if (-not $seedFailMode) { $seedFailMode = "fail-open" }
  $seedMinIntervalRaw = if ($env:BRAINDRIVE_UPDATES_MIN_CHECK_INTERVAL_MINUTES) { $env:BRAINDRIVE_UPDATES_MIN_CHECK_INTERVAL_MINUTES.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_UPDATES_MIN_CHECK_INTERVAL_MINUTES" }
  if (-not $seedMinIntervalRaw) { $seedMinIntervalRaw = "60" }
  $seedMinInterval = 60
  if (-not [int]::TryParse($seedMinIntervalRaw, [ref]$seedMinInterval)) { $seedMinInterval = 60 }

  $seedWindowEnabledRaw = if ($env:BRAINDRIVE_UPDATES_WINDOW_ENABLED) { $env:BRAINDRIVE_UPDATES_WINDOW_ENABLED.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_UPDATES_WINDOW_ENABLED" }
  if (-not $seedWindowEnabledRaw) { $seedWindowEnabledRaw = "false" }
  $seedWindowTimezone = if ($env:BRAINDRIVE_UPDATES_WINDOW_TIMEZONE) { $env:BRAINDRIVE_UPDATES_WINDOW_TIMEZONE.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_UPDATES_WINDOW_TIMEZONE" }
  if (-not $seedWindowTimezone) { $seedWindowTimezone = "UTC" }
  $seedWindowDaysRaw = if ($env:BRAINDRIVE_UPDATES_WINDOW_DAYS) { $env:BRAINDRIVE_UPDATES_WINDOW_DAYS.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_UPDATES_WINDOW_DAYS" }
  if (-not $seedWindowDaysRaw) { $seedWindowDaysRaw = "Monday" }
  $seedWindowDays = $seedWindowDaysRaw.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  if ($seedWindowDays.Count -eq 0) { $seedWindowDays = @("Monday") }
  $seedWindowStart = if ($env:BRAINDRIVE_UPDATES_WINDOW_START) { $env:BRAINDRIVE_UPDATES_WINDOW_START.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_UPDATES_WINDOW_START" }
  if (-not $seedWindowStart) { $seedWindowStart = "13:00" }
  $seedWindowEnd = if ($env:BRAINDRIVE_UPDATES_WINDOW_END) { $env:BRAINDRIVE_UPDATES_WINDOW_END.Trim('"') } else { Get-EnvValue -Key "BRAINDRIVE_UPDATES_WINDOW_END" }
  if (-not $seedWindowEnd) { $seedWindowEnd = "18:00" }

  $seedResult = Ensure-ConfigDefaults -ExistingJson $configJson -Defaults @{
    enabled = (Convert-ToBool -Value $seedUpdatesEnabledRaw)
    startup_check = (Convert-ToBool -Value $seedStartupCheckRaw)
    policy = $seedPolicy
    fail_mode = $seedFailMode
    min_check_interval_minutes = $seedMinInterval
    window_enabled = (Convert-ToBool -Value $seedWindowEnabledRaw)
    window_timezone = $seedWindowTimezone
    window_days = $seedWindowDays
    window_start = $seedWindowStart
    window_end = $seedWindowEnd
  }

  if ($seedResult.Json) {
    $configJson = $seedResult.Json
    $null = Write-VolumeFile -Path $configVolumePath -Content $configJson
  }

  $config = Parse-Config -JsonText $configJson

  $updatesEnabledRaw = Resolve-Setting -RuntimeValue $env:BRAINDRIVE_UPDATES_ENABLED -ConfigValue $config.enabled -EnvFileValue (Get-EnvValue -Key "BRAINDRIVE_UPDATES_ENABLED") -DefaultValue "true"
  $startupCheckRaw = Resolve-Setting -RuntimeValue $env:BRAINDRIVE_STARTUP_UPDATE_CHECK -ConfigValue $config.startup_check -EnvFileValue (Get-EnvValue -Key "BRAINDRIVE_STARTUP_UPDATE_CHECK") -DefaultValue "true"
  $updatesPolicy = (Resolve-Setting -RuntimeValue $env:BRAINDRIVE_UPDATES_POLICY -ConfigValue $config.policy -EnvFileValue (Get-EnvValue -Key "BRAINDRIVE_UPDATES_POLICY") -DefaultValue "auto-apply").ToLowerInvariant()
  $updatesFailMode = (Resolve-Setting -RuntimeValue $env:BRAINDRIVE_UPDATES_FAIL_MODE -ConfigValue $config.fail_mode -EnvFileValue (Get-EnvValue -Key "BRAINDRIVE_UPDATES_FAIL_MODE") -DefaultValue "fail-open").ToLowerInvariant()

  $minCheckIntervalRaw = Resolve-Setting -RuntimeValue $env:BRAINDRIVE_UPDATES_MIN_CHECK_INTERVAL_MINUTES -ConfigValue $config.min_check_interval_minutes -EnvFileValue (Get-EnvValue -Key "BRAINDRIVE_UPDATES_MIN_CHECK_INTERVAL_MINUTES") -DefaultValue "60"
  $minCheckInterval = 60
  if (-not [int]::TryParse($minCheckIntervalRaw, [ref]$minCheckInterval)) {
    $minCheckInterval = 60
  }

  $windowEnabledRaw = Resolve-Setting -RuntimeValue $env:BRAINDRIVE_UPDATES_WINDOW_ENABLED -ConfigValue $config.window_enabled -EnvFileValue (Get-EnvValue -Key "BRAINDRIVE_UPDATES_WINDOW_ENABLED") -DefaultValue "false"
  $windowTimezone = Resolve-Setting -RuntimeValue $env:BRAINDRIVE_UPDATES_WINDOW_TIMEZONE -ConfigValue $config.window_timezone -EnvFileValue (Get-EnvValue -Key "BRAINDRIVE_UPDATES_WINDOW_TIMEZONE") -DefaultValue "UTC"
  $windowDays = Resolve-Setting -RuntimeValue $env:BRAINDRIVE_UPDATES_WINDOW_DAYS -ConfigValue $config.window_days -EnvFileValue (Get-EnvValue -Key "BRAINDRIVE_UPDATES_WINDOW_DAYS") -DefaultValue "Monday"
  $windowStart = Resolve-Setting -RuntimeValue $env:BRAINDRIVE_UPDATES_WINDOW_START -ConfigValue $config.window_start -EnvFileValue (Get-EnvValue -Key "BRAINDRIVE_UPDATES_WINDOW_START") -DefaultValue "13:00"
  $windowEnd = Resolve-Setting -RuntimeValue $env:BRAINDRIVE_UPDATES_WINDOW_END -ConfigValue $config.window_end -EnvFileValue (Get-EnvValue -Key "BRAINDRIVE_UPDATES_WINDOW_END") -DefaultValue "18:00"

  $updatesEnabled = Convert-ToBool -Value $updatesEnabledRaw
  $startupCheckEnabled = Convert-ToBool -Value $startupCheckRaw
  $windowEnabled = Convert-ToBool -Value $windowEnabledRaw

  if (-not $updatesEnabled -or -not $startupCheckEnabled -or $updatesPolicy -eq "disabled") {
    Write-Host "Startup update check disabled by policy."
    exit 0
  }

  $stateJson = Read-VolumeFile -Path $stateVolumePath
  if (-not $stateJson -and (Test-Path $stateFallbackPath)) {
    $stateJson = Get-Content -Raw -Path $stateFallbackPath
  }
  $state = Parse-State -JsonText $stateJson

  $gate = Test-IntervalGate -LastCheckedAt $state.last_checked_at -NextRetryAt $state.next_retry_at -MinCheckIntervalMinutes $minCheckInterval
  if (-not $gate.check) {
    Write-Host "Startup update check deferred ($($gate.reason))."
    exit 0
  }

  Write-Host "Startup update check: policy=$updatesPolicy, mode=$Mode"

  $originalDryRun = $env:BRAINDRIVE_UPGRADE_DRY_RUN
  $originalLastApp = $env:BRAINDRIVE_LAST_APPLIED_APP_REF
  $originalLastEdge = $env:BRAINDRIVE_LAST_APPLIED_EDGE_REF

  $env:BRAINDRIVE_UPGRADE_DRY_RUN = "true"
  $env:BRAINDRIVE_LAST_APPLIED_APP_REF = $state.last_applied_app_ref
  $env:BRAINDRIVE_LAST_APPLIED_EDGE_REF = $state.last_applied_edge_ref

  $dryRunOutput = & "$scriptDir/upgrade.ps1" -Mode $Mode 2>&1
  $dryRunExit = $LASTEXITCODE

  if ($null -eq $originalDryRun) { Remove-Item Env:\BRAINDRIVE_UPGRADE_DRY_RUN -ErrorAction SilentlyContinue } else { $env:BRAINDRIVE_UPGRADE_DRY_RUN = $originalDryRun }
  if ($null -eq $originalLastApp) { Remove-Item Env:\BRAINDRIVE_LAST_APPLIED_APP_REF -ErrorAction SilentlyContinue } else { $env:BRAINDRIVE_LAST_APPLIED_APP_REF = $originalLastApp }
  if ($null -eq $originalLastEdge) { Remove-Item Env:\BRAINDRIVE_LAST_APPLIED_EDGE_REF -ErrorAction SilentlyContinue } else { $env:BRAINDRIVE_LAST_APPLIED_EDGE_REF = $originalLastEdge }

  $dryRunOutput | ForEach-Object { Write-Host $_ }

  if ($dryRunExit -ne 0 -and $dryRunExit -ne 10) {
    $failures = 0
    [int]::TryParse($state.consecutive_failures, [ref]$failures) | Out-Null
    $failures += 1
    $nextRetry = Get-NextRetryIso -Failures $failures

    Write-State -Status "error" -ErrorMessage "dry-run-upgrade-check-failed" -PendingUpdate $false -PendingReason "check-failed" -AvailableVersion "" -AppliedVersion $state.last_applied_version -AppliedAppRef $state.last_applied_app_ref -AppliedEdgeRef $state.last_applied_edge_ref -ConsecutiveFailures $failures -NextRetryAt $nextRetry

    if ($updatesFailMode -eq "fail-closed") {
      Write-Host "Startup update check failed in fail-closed mode."
      exit 40
    }

    Write-Host "Startup update check failed; continuing because fail-open mode is active."
    exit 0
  }

  $checkMap = Parse-CheckOutput -Lines $dryRunOutput
  $targetAppRef = if ($checkMap.ContainsKey("CHECK_TARGET_APP_REF")) { $checkMap["CHECK_TARGET_APP_REF"] } else { "" }
  $targetEdgeRef = if ($checkMap.ContainsKey("CHECK_TARGET_EDGE_REF")) { $checkMap["CHECK_TARGET_EDGE_REF"] } else { "" }
  $resolvedVersion = if ($checkMap.ContainsKey("CHECK_RESOLVED_VERSION")) { $checkMap["CHECK_RESOLVED_VERSION"] } else { "" }

  $updateAvailable = $false
  if ($dryRunExit -eq 10) {
    $updateAvailable = $true
  } elseif ($checkMap.ContainsKey("CHECK_UPDATE_AVAILABLE")) {
    $updateAvailable = Convert-ToBool -Value $checkMap["CHECK_UPDATE_AVAILABLE"]
  }

  if (-not $updateAvailable) {
    Write-State -Status "ok" -ErrorMessage "" -PendingUpdate $false -PendingReason "" -AvailableVersion $resolvedVersion -AppliedVersion $resolvedVersion -AppliedAppRef $targetAppRef -AppliedEdgeRef $targetEdgeRef -ConsecutiveFailures 0 -NextRetryAt ""
    Write-Host "Startup update check complete: no update available."
    exit 0
  }

  if ($updatesPolicy -eq "check-only") {
    Write-State -Status "ok" -ErrorMessage "" -PendingUpdate $true -PendingReason "check-only" -AvailableVersion $resolvedVersion -AppliedVersion $state.last_applied_version -AppliedAppRef $state.last_applied_app_ref -AppliedEdgeRef $state.last_applied_edge_ref -ConsecutiveFailures 0 -NextRetryAt ""
    Write-Host "Update available but deferred (check-only policy)."
    exit 10
  }

  if ($updatesPolicy -eq "windowed-apply") {
    $window = Test-WindowAllowsApply -Enabled $windowEnabled -Timezone $windowTimezone -Days $windowDays -StartTime $windowStart -EndTime $windowEnd
    if (-not $window.allow) {
      Write-State -Status "ok" -ErrorMessage "" -PendingUpdate $true -PendingReason $window.reason -AvailableVersion $resolvedVersion -AppliedVersion $state.last_applied_version -AppliedAppRef $state.last_applied_app_ref -AppliedEdgeRef $state.last_applied_edge_ref -ConsecutiveFailures 0 -NextRetryAt ""
      Write-Host "Update available but outside allowed apply window ($($window.reason))."
      exit 10
    }
  }

  Write-Host "Applying update before startup..."
  $applyOutput = & "$scriptDir/upgrade.ps1" -Mode $Mode 2>&1
  $applyExit = $LASTEXITCODE
  $applyOutput | ForEach-Object { Write-Host $_ }

  if ($applyExit -ne 0) {
    $failures = 0
    [int]::TryParse($state.consecutive_failures, [ref]$failures) | Out-Null
    $failures += 1
    $nextRetry = Get-NextRetryIso -Failures $failures

    Write-State -Status "error" -ErrorMessage "update-apply-failed" -PendingUpdate $true -PendingReason "apply-failed" -AvailableVersion $resolvedVersion -AppliedVersion $state.last_applied_version -AppliedAppRef $state.last_applied_app_ref -AppliedEdgeRef $state.last_applied_edge_ref -ConsecutiveFailures $failures -NextRetryAt $nextRetry

    if ($updatesFailMode -eq "fail-closed") {
      Write-Host "Auto-apply failed in fail-closed mode."
      exit 50
    }

    Write-Host "Auto-apply failed; continuing because fail-open mode is active."
    exit 0
  }

  Write-State -Status "ok" -ErrorMessage "" -PendingUpdate $false -PendingReason "" -AvailableVersion $resolvedVersion -AppliedVersion $resolvedVersion -AppliedAppRef $targetAppRef -AppliedEdgeRef $targetEdgeRef -ConsecutiveFailures 0 -NextRetryAt ""
  Write-Host "Startup update applied successfully."
  exit 20
}
finally {
  Remove-Item -LiteralPath $lockPath -Recurse -Force -ErrorAction SilentlyContinue
}
