$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
$source = Split-Path -Parent $source
$target = 'C:\Users\icj24\Downloads\historyprofile_app'

Write-Host "Source: $source"
Write-Host "Target: $target"

if (!(Test-Path $target)) {
  throw "Target folder not found: $target"
}

$exclude = @('.git', 'frontend\\node_modules', 'frontend\\dist', 'backend\\runtime')
robocopy $source $target /MIR /XD $exclude /XF .env .env.* > $null
if ($LASTEXITCODE -gt 7) {
  throw "robocopy failed with exit code $LASTEXITCODE"
}
Write-Host 'Project files copied successfully.'
