$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir/../docker/scripts/install.ps1" @args
