param(
  [ValidateSet("quickstart", "prod", "local", "dev")]
  [string]$Mode = "quickstart",
  [string]$SinceWindow = "24h",
  [string]$OutputDir = "",
  [switch]$SkipHealth
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

if (-not $OutputDir) {
  $OutputDir = Join-Path $rootDir "support-bundles"
}

$composeFile = "compose.quickstart.yml"
if ($Mode -eq "prod") {
  $composeFile = "compose.prod.yml"
} elseif ($Mode -eq "local") {
  $composeFile = "compose.local.yml"
} elseif ($Mode -eq "dev") {
  $composeFile = "compose.dev.yml"
}

$timestampUtc = (Get-Date).ToUniversalTime().ToString("yyyyMMdd_HHmmss")
$bundleName = "support-bundle-$Mode-$timestampUtc"
$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("braindrive-support-" + [Guid]::NewGuid().ToString("N"))
$bundleRoot = Join-Path $stagingRoot $bundleName
$logsDir = Join-Path $bundleRoot "logs"
$metadataDir = Join-Path $bundleRoot "metadata"
$healthDir = Join-Path $bundleRoot "health"
$memoryDir = Join-Path $bundleRoot "memory"
$warningsPath = Join-Path $metadataDir "warnings.txt"

New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
New-Item -ItemType Directory -Path $metadataDir -Force | Out-Null
New-Item -ItemType Directory -Path $healthDir -Force | Out-Null
New-Item -ItemType Directory -Path $memoryDir -Force | Out-Null

function Add-WarningLine {
  param([string]$Message)
  Add-Content -LiteralPath $warningsPath -Value $Message
}

function Invoke-CaptureCommand {
  param(
    [string]$OutputPath,
    [string]$Exe,
    [string[]]$Args
  )

  try {
    $output = & $Exe @Args 2>&1
    $exitCode = $LASTEXITCODE
    if ($null -eq $output) {
      $output = @()
    }
    $output | Out-File -LiteralPath $OutputPath -Encoding utf8
    if ($exitCode -ne 0) {
      Add-WarningLine "Command failed ($exitCode): $Exe $($Args -join ' ')"
    }
  } catch {
    $_ | Out-File -LiteralPath $OutputPath -Encoding utf8
    Add-WarningLine "Command raised exception: $Exe $($Args -join ' ') -> $($_.Exception.Message)"
  }
}

$runtimeMetadataPath = Join-Path $metadataDir "runtime-metadata.json"
@"
{
  "generated_at_utc": "$((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))",
  "mode": "$Mode",
  "compose_file": "$composeFile",
  "since_window": "$SinceWindow"
}
"@ | Out-File -LiteralPath $runtimeMetadataPath -Encoding utf8

Invoke-CaptureCommand -OutputPath (Join-Path $metadataDir "docker-version.txt") -Exe "docker" -Args @("version")
Invoke-CaptureCommand -OutputPath (Join-Path $metadataDir "docker-compose-version.txt") -Exe "docker" -Args @("compose", "version")
Invoke-CaptureCommand -OutputPath (Join-Path $metadataDir "compose-ps.txt") -Exe "docker" -Args @("compose", "-f", $composeFile, "ps")
Invoke-CaptureCommand -OutputPath (Join-Path $metadataDir "compose-config-services.txt") -Exe "docker" -Args @("compose", "-f", $composeFile, "config", "--services")
Invoke-CaptureCommand -OutputPath (Join-Path $metadataDir "compose-config-rendered.txt") -Exe "docker" -Args @("compose", "-f", $composeFile, "config")

$services = @()
try {
  $serviceOutput = & docker compose -f $composeFile config --services 2>$null
  if ($LASTEXITCODE -eq 0) {
    $services = @($serviceOutput | Where-Object { $_ -and $_.Trim().Length -gt 0 } | ForEach-Object { $_.Trim() })
  }
} catch {
  $services = @()
}

if ($services.Count -eq 0) {
  if ($Mode -eq "dev") {
    $services = @("app", "web")
  } else {
    $services = @("app", "edge")
  }
  Add-WarningLine "Unable to resolve services from compose config; using fallback list for mode $Mode"
}

foreach ($service in $services) {
  $logPath = Join-Path $logsDir "$service.log"
  Invoke-CaptureCommand -OutputPath $logPath -Exe "docker" -Args @("compose", "-f", $composeFile, "logs", "--no-color", "--timestamps", "--since", $SinceWindow, $service)
}

if (-not $SkipHealth) {
  $healthTargets = @(
    @{ Name = "gateway-health.json"; Url = "http://127.0.0.1:8787/health" },
    @{ Name = "edge-health.json"; Url = "http://127.0.0.1:8080/health" }
  )

  foreach ($target in $healthTargets) {
    $outputPath = Join-Path $healthDir $target.Name
    $errorPath = Join-Path $healthDir ($target.Name + ".error.log")
    try {
      $response = Invoke-WebRequest -Uri $target.Url -TimeoutSec 8 -UseBasicParsing
      $response.Content | Out-File -LiteralPath $outputPath -Encoding utf8
    } catch {
      $_.Exception.Message | Out-File -LiteralPath $errorPath -Encoding utf8
      Add-WarningLine "Health snapshot failed: $($target.Url)"
    }
  }

  if ($Mode -eq "prod" -and (Test-Path ".env")) {
    $domainLine = Get-Content ".env" | Where-Object { $_ -match "^DOMAIN=" } | Select-Object -First 1
    if ($domainLine) {
      $domainValue = ($domainLine.Split("=", 2)[1]).Trim().Trim('"')
      if ($domainValue -and $domainValue -ne "app.example.com") {
        $publicOutput = Join-Path $healthDir "public-health.json"
        $publicError = Join-Path $healthDir "public-health.error.log"
        try {
          $response = Invoke-WebRequest -Uri "https://$domainValue/health" -TimeoutSec 8 -UseBasicParsing
          $response.Content | Out-File -LiteralPath $publicOutput -Encoding utf8
        } catch {
          $_.Exception.Message | Out-File -LiteralPath $publicError -Encoding utf8
          Add-WarningLine "Health snapshot failed: https://$domainValue/health"
        }
      }
    }
  }
}

$memoryCopyLog = Join-Path $metadataDir "memory-audit-copy.log"
$copyScript = "mkdir -p /bundle/memory && if [ -d /memory/diagnostics/audit ]; then cp -a /memory/diagnostics/audit /bundle/memory/ && chmod -R a+rwX /bundle/memory/audit || true; else echo 'No persisted audit logs found under /memory/diagnostics/audit' > /bundle/memory/audit-missing.txt; fi"
Invoke-CaptureCommand -OutputPath $memoryCopyLog -Exe "docker" -Args @("run", "--rm", "-v", "braindrive_memory:/memory:ro", "-v", "${bundleRoot}:/bundle", "alpine:3.20", "sh", "-lc", $copyScript)

function Redact-FileContent {
  param([string]$FilePath)

  $content = Get-Content -LiteralPath $FilePath -Raw
  if ($null -eq $content) {
    return
  }

  $content = $content -replace "Bearer\s+[A-Za-z0-9._-]{8,}", "Bearer [REDACTED]"
  $content = $content -replace "\bsk-[A-Za-z0-9_-]{8,}\b", "[REDACTED]"
  $content = $content -replace "((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)(\""[^\""]*\""|[^,\s}]+)", '$1[REDACTED]'
  $content = $content -replace "-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----", "[REDACTED]"

  Set-Content -LiteralPath $FilePath -Value $content -Encoding utf8
}

$textFiles = Get-ChildItem -LiteralPath $bundleRoot -Recurse -File |
  Where-Object { $_.Extension -in @(".log", ".txt", ".json", ".jsonl", ".md") }
foreach ($file in $textFiles) {
  Redact-FileContent -FilePath $file.FullName
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$archivePath = Join-Path $OutputDir "$bundleName.zip"
if (Test-Path $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -Path $bundleRoot -DestinationPath $archivePath -CompressionLevel Optimal

Write-Host "Support bundle created: $archivePath"

Remove-Item -LiteralPath $stagingRoot -Recurse -Force
