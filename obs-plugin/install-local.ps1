# Install only this plugin. Run with OBS closed; administrator rights may be required.
$ErrorActionPreference = 'Stop'
try {
if (Get-Process obs64 -ErrorAction SilentlyContinue) { Wait-Process -Name obs64 -Timeout 15 -ErrorAction SilentlyContinue }
if (Get-Process obs64 -ErrorAction SilentlyContinue) { throw 'Close OBS before installing the Playback plugin.' }
$source = Join-Path $PSScriptRoot 'package/obs-plugins/64bit/fplayback-youtube.dll'
$target = 'C:/Program Files/obs-studio/obs-plugins/64bit/fplayback-youtube.dll'
if (!(Test-Path -LiteralPath $source)) { throw 'Build the plugin before installing.' }
if (!(Test-Path -LiteralPath (Split-Path -Parent $target))) { throw 'OBS installation not found.' }
if (Test-Path -LiteralPath $target) {
  $backup = Join-Path $PSScriptRoot ('package/fplayback-youtube-before-install-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.dll')
  Copy-Item -LiteralPath $target -Destination $backup
}
Copy-Item -LiteralPath $source -Destination $target -Force
if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $target).Hash) { throw 'Installed checksum mismatch.' }
Write-Output 'Playback OBS plugin installed and checksum verified.'
} catch {
  $_.Exception.Message | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'package/install-error.txt')
  exit 1
}
