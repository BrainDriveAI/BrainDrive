param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$McpRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\mcp_release")).Path,
  [string]$OutputRoot = (Join-Path $ProjectRoot "src-tauri\desktop-runtime")
)

$ErrorActionPreference = "Stop"

function Assert-PathExists {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label was not found at $Path"
  }
}

function Copy-Directory {
  param(
    [string]$Source,
    [string]$Destination
  )

  Assert-PathExists -Path $Source -Label "Required runtime directory"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Copy-File {
  param(
    [string]$Source,
    [string]$Destination
  )

  Assert-PathExists -Path $Source -Label "Required runtime file"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

$nodePath = (Get-Command node -ErrorAction Stop).Source

Assert-PathExists -Path (Join-Path $ProjectRoot "dist\gateway\server.js") -Label "BrainDrive gateway build"
Assert-PathExists -Path (Join-Path $ProjectRoot "adapters\openai-compatible.json") -Label "BrainDrive adapter configuration"
Assert-PathExists -Path (Join-Path $ProjectRoot "memory\starter-pack") -Label "BrainDrive starter memory"
Assert-PathExists -Path (Join-Path $ProjectRoot "node_modules") -Label "BrainDrive gateway dependencies"
Assert-PathExists -Path (Join-Path $McpRoot "dist\src\index.js") -Label "BrainDrive MCP build"
Assert-PathExists -Path (Join-Path $McpRoot "node_modules") -Label "BrainDrive MCP dependencies"

if (Test-Path -LiteralPath $OutputRoot) {
  Remove-Item -LiteralPath $OutputRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

$nodeExeName = if ($IsWindows -or $env:OS -eq "Windows_NT") { "node.exe" } else { "node" }
Copy-File -Source $nodePath -Destination (Join-Path $OutputRoot "node\$nodeExeName")

Copy-Directory -Source (Join-Path $ProjectRoot "dist") -Destination (Join-Path $OutputRoot "typescript\dist")
Copy-Directory -Source (Join-Path $ProjectRoot "adapters") -Destination (Join-Path $OutputRoot "typescript\adapters")
Copy-Directory -Source (Join-Path $ProjectRoot "memory\starter-pack") -Destination (Join-Path $OutputRoot "typescript\memory\starter-pack")
Copy-Directory -Source (Join-Path $ProjectRoot "node_modules") -Destination (Join-Path $OutputRoot "typescript\node_modules")
Copy-File -Source (Join-Path $ProjectRoot "package.json") -Destination (Join-Path $OutputRoot "typescript\package.json")
Copy-File -Source (Join-Path $ProjectRoot "package-lock.json") -Destination (Join-Path $OutputRoot "typescript\package-lock.json")
Copy-File -Source (Join-Path $ProjectRoot "config.json") -Destination (Join-Path $OutputRoot "typescript\config.json")

Copy-Directory -Source (Join-Path $McpRoot "dist") -Destination (Join-Path $OutputRoot "mcp_release\dist")
Copy-Directory -Source (Join-Path $McpRoot "node_modules") -Destination (Join-Path $OutputRoot "mcp_release\node_modules")
Copy-File -Source (Join-Path $McpRoot "package.json") -Destination (Join-Path $OutputRoot "mcp_release\package.json")
Copy-File -Source (Join-Path $McpRoot "package-lock.json") -Destination (Join-Path $OutputRoot "mcp_release\package-lock.json")

Write-Host "Staged BrainDrive desktop runtime at $OutputRoot"
