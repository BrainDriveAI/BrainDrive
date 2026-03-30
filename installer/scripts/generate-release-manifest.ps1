$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir/../docker/scripts/generate-release-manifest.ps1" @args
