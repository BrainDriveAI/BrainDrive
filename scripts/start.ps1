$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($args.Count -eq 0) {
  & "$scriptDir/../installer/docker/scripts/start.ps1" "local"
} else {
  & "$scriptDir/../installer/docker/scripts/start.ps1" @args
}
