$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($args.Count -eq 0) {
  & "$scriptDir/../installer/docker/scripts/stop.ps1" "local"
} else {
  & "$scriptDir/../installer/docker/scripts/stop.ps1" @args
}
