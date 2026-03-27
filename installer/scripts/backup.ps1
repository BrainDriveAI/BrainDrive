$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir/../docker/scripts/backup.ps1" @args
