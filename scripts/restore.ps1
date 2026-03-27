$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir/../installer/docker/scripts/restore.ps1" @args
