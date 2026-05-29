[CmdletBinding()]
param(
  [string]$MacHost,
  [string]$Ref,
  [string]$RepoUrl,
  [string]$RemoteBaseDir = "~/braindrive-remote-builds",
  [string]$OutputDir,
  [string]$RemoteSetupCommand = "",
  [string]$RemoteBuildCommand = "npm run desktop:build:mac",
  [switch]$RequireClean,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Show-Usage {
  Write-Host @"
Build the macOS Tauri desktop installer on a remote Mac over SSH.

Usage:
  powershell -ExecutionPolicy Bypass -File scripts/remote-mac-build.ps1 -MacHost "user@mac-mini.local"

Common options:
  -Ref "feature(desktop)/mac-browser-access-bridge"
  -RepoUrl "git@github.com:BrainDriveAI/BrainDrive.git"
  -OutputDir "C:\Users\DJJones\Downloads\braindrive-mac-build"
  -RemoteSetupCommand "security unlock-keychain ~/Library/Keychains/login.keychain-db"
  -RemoteBuildCommand "npm run desktop:build:mac"
  -RequireClean

The remote Mac must already be able to clone the repo and run the signed macOS build.
"@
}

function ConvertTo-PosixShellArgument {
  param([AllowNull()][string]$Value)

  if ($null -eq $Value) {
    return "''"
  }

  $singleQuote = "'"
  return $singleQuote + $Value.Replace($singleQuote, "$singleQuote\$singleQuote$singleQuote") + $singleQuote
}

function Invoke-Git {
  param(
    [string]$RepoRoot,
    [string[]]$GitArgs
  )

  $output = & git -C $RepoRoot @GitArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git $($GitArgs -join ' ') failed: $output"
  }

  return ($output | Out-String).Trim()
}

if ($Help) {
  Show-Usage
  exit 0
}

if ([string]::IsNullOrWhiteSpace($MacHost)) {
  Show-Usage
  throw "MacHost is required. Example: -MacHost `"user@mac-mini.local`""
}

foreach ($command in @("git", "ssh", "scp", "tar")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "Required command '$command' was not found on PATH."
  }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$typeScriptRoot = Resolve-Path (Join-Path $scriptRoot "..")
$repoRoot = Invoke-Git -RepoRoot $typeScriptRoot -GitArgs @("rev-parse", "--show-toplevel")
$currentBranch = Invoke-Git -RepoRoot $repoRoot -GitArgs @("rev-parse", "--abbrev-ref", "HEAD")

if ([string]::IsNullOrWhiteSpace($Ref)) {
  $Ref = $currentBranch
  if ($Ref -eq "HEAD") {
    $Ref = Invoke-Git -RepoRoot $repoRoot -GitArgs @("rev-parse", "HEAD")
  }
}

if ([string]::IsNullOrWhiteSpace($RepoUrl)) {
  $RepoUrl = Invoke-Git -RepoRoot $repoRoot -GitArgs @("remote", "get-url", "origin")
}

$status = Invoke-Git -RepoRoot $repoRoot -GitArgs @("status", "--short")
if (-not [string]::IsNullOrWhiteSpace($status)) {
  $message = "Local changes are not included in a remote clone build until they are committed and pushed."
  if ($RequireClean) {
    throw $message
  }

  Write-Warning $message
}

if ($currentBranch -ne "HEAD" -and $Ref -eq $currentBranch) {
  $pushWarning = ""
  try {
    $upstream = Invoke-Git -RepoRoot $repoRoot -GitArgs @("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    $aheadBehind = Invoke-Git -RepoRoot $repoRoot -GitArgs @("rev-list", "--left-right", "--count", "$upstream...HEAD")
    $counts = $aheadBehind -split "\s+"
    $ahead = [int]$counts[1]

    if ($ahead -gt 0) {
      $pushWarning = "Local branch '$currentBranch' is $ahead commit(s) ahead of '$upstream'; push before release so the Mac clones the same code."
    }
  } catch {
    Write-Warning "Could not compare '$currentBranch' to its upstream branch: $($_.Exception.Message)"
  }

  if (-not [string]::IsNullOrWhiteSpace($pushWarning)) {
    if ($RequireClean) {
      throw $pushWarning
    }

    Write-Warning $pushWarning
  }
}

$runId = Get-Date -Format "yyyyMMdd-HHmmss"
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $typeScriptRoot "src-tauri\target\remote-mac-builds\$runId"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$localArchive = Join-Path $OutputDir "braindrive-macos-artifacts-$runId.tgz"

$remoteScript = @'
set -euo pipefail

repo_url="$1"
git_ref="$2"
remote_base="$3"
run_id="$4"
setup_command="$5"
build_command="$6"

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

remote_base="${remote_base%/}"
case "$remote_base" in
  "~")
    remote_base="$HOME"
    ;;
  "~/"*)
    remote_base="$HOME/${remote_base#~/}"
    ;;
esac
run_dir="$remote_base/$run_id"
repo_dir="$run_dir/BrainDrive"
archive_path="$run_dir/braindrive-macos-artifacts-$run_id.tgz"
file_list="$run_dir/artifact-files.txt"

mkdir -p "$run_dir"

echo "Remote run directory: $run_dir"
echo "Cloning $repo_url"
git clone "$repo_url" "$repo_dir"

cd "$repo_dir"
git fetch --tags origin
git checkout "$git_ref"
git submodule update --init --recursive

cd "$repo_dir/builds/typescript"

if [ -n "$setup_command" ]; then
  echo "Running remote setup command"
  bash -lc "$setup_command"
fi

echo "Installing TypeScript runtime dependencies"
npm ci

echo "Installing MCP release dependencies"
npm --prefix ../mcp_release ci

echo "Installing web client dependencies"
npm --prefix client_web ci

echo "Running macOS desktop build"
bash -lc "$build_command"

bundle_dir="$PWD/src-tauri/target/release/bundle"
if [ ! -d "$bundle_dir" ]; then
  echo "Expected bundle directory was not found: $bundle_dir" >&2
  exit 1
fi

: > "$file_list"
cd "$bundle_dir"
if [ -d dmg ]; then
  find dmg -maxdepth 1 -type f -name "*.dmg" | sort >> "$file_list"
fi
if [ -d latest ]; then
  find latest -maxdepth 1 -type f \( -name "BrainDrive-latest-macos.dmg" -o -name "BrainDrive-latest-macos.dmg.sha256" \) | sort >> "$file_list"
fi

if [ ! -s "$file_list" ]; then
  echo "No macOS DMG artifacts were found in $bundle_dir" >&2
  exit 1
fi

echo "Packaging artifacts"
tar -czf "$archive_path" -T "$file_list"
shasum -a 256 "$archive_path" > "$archive_path.sha256"

archive_abs_dir="$(cd "$(dirname "$archive_path")" && pwd)"
archive_abs_path="$archive_abs_dir/$(basename "$archive_path")"

echo "BRAINDRIVE_REMOTE_ARCHIVE=$archive_abs_path"
echo "BRAINDRIVE_REMOTE_ARCHIVE_SHA256=$archive_abs_path.sha256"
'@

$remoteArgs = @(
  (ConvertTo-PosixShellArgument $RepoUrl),
  (ConvertTo-PosixShellArgument $Ref),
  (ConvertTo-PosixShellArgument $RemoteBaseDir),
  (ConvertTo-PosixShellArgument $runId),
  (ConvertTo-PosixShellArgument $RemoteSetupCommand),
  (ConvertTo-PosixShellArgument $RemoteBuildCommand)
) -join " "

$remoteCommand = "bash -s -- $remoteArgs"

Write-Host "Starting remote macOS build on $MacHost"
Write-Host "Git ref: $Ref"
Write-Host "Local artifact output: $OutputDir"

$remoteOutput = New-Object System.Collections.Generic.List[string]
$remoteScript | & ssh $MacHost $remoteCommand 2>&1 | ForEach-Object {
  $line = $_.ToString()
  $remoteOutput.Add($line)
  Write-Host $line
}

if ($LASTEXITCODE -ne 0) {
  throw "Remote macOS build failed on $MacHost."
}

$archiveLine = $remoteOutput | Where-Object { $_ -like "BRAINDRIVE_REMOTE_ARCHIVE=*" } | Select-Object -Last 1
$archiveHashLine = $remoteOutput | Where-Object { $_ -like "BRAINDRIVE_REMOTE_ARCHIVE_SHA256=*" } | Select-Object -Last 1

if ([string]::IsNullOrWhiteSpace($archiveLine)) {
  throw "Remote build completed, but no artifact archive path was reported."
}

$remoteArchive = $archiveLine.Substring("BRAINDRIVE_REMOTE_ARCHIVE=".Length)
$remoteArchiveHash = ""
if (-not [string]::IsNullOrWhiteSpace($archiveHashLine)) {
  $remoteArchiveHash = $archiveHashLine.Substring("BRAINDRIVE_REMOTE_ARCHIVE_SHA256=".Length)
}

Write-Host "Copying remote artifact archive"
& scp "${MacHost}:$(ConvertTo-PosixShellArgument $remoteArchive)" $localArchive
if ($LASTEXITCODE -ne 0) {
  throw "Failed to copy remote artifact archive from $MacHost."
}

if (-not [string]::IsNullOrWhiteSpace($remoteArchiveHash)) {
  & scp "${MacHost}:$(ConvertTo-PosixShellArgument $remoteArchiveHash)" "$localArchive.sha256"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to copy remote artifact archive checksum from $MacHost."
  }
}

Write-Host "Extracting artifacts"
& tar -xzf $localArchive -C $OutputDir
if ($LASTEXITCODE -ne 0) {
  throw "Failed to extract $localArchive."
}

Write-Host "Remote macOS build artifacts are ready in $OutputDir"
