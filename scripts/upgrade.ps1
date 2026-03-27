$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir/../installer/docker/scripts/upgrade.ps1" @args
