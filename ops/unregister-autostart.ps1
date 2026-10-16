$ErrorActionPreference = 'Stop'
Unregister-ScheduledTask -TaskName 'fKeyLabs Playback' -Confirm:$false
Write-Host 'fKeyLabs Playback autostart removed.'