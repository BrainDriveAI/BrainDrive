$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir/../docker/scripts/reset-new-user.ps1" @args
