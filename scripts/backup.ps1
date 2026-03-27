$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir/../installer/docker/scripts/backup.ps1" @args
