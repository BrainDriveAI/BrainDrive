function Invoke-CheckedNativeCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  & $Command @Arguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "$FailureMessage (exit code $exitCode)."
  }
}
