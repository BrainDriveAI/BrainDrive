$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($args.Count -eq 0) {
  & "$scriptDir/../docker/scripts/start.ps1" "local"
} else {
  & "$scriptDir/../docker/scripts/start.ps1" @args
}
