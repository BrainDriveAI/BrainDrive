$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir/../installer/docker/scripts/install.ps1" @args
