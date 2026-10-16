# Run explicitly in PowerShell when you want Playback to start at Windows sign-in.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = (Get-Command node.exe -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/d /c `"`"$root\ops\start-player-supervised.bat`"`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'fKeyLabs Playback' -Description 'fKeyLabs Playback local 24/7 backend' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host 'Autostart installed for the current Windows user. The station will start on next sign-in.'
Write-Host 'OBS itself must also be configured to start and keep its Browser Source active.'