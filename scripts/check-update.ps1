$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($args.Count -eq 0) {
  & "$scriptDir/../installer/docker/scripts/check-update.ps1" "quickstart"
} else {
  & "$scriptDir/../installer/docker/scripts/check-update.ps1" @args
}
