$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir/../installer/docker/scripts/reset-new-user.ps1" @args
