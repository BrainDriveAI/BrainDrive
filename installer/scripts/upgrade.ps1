$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir/../docker/scripts/upgrade.ps1" @args
