#Requires -Version 5.1
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    Write-Host 'Removing the Windows boot task requires administrator approval...'
    try {
        $elevated = Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath) -Verb RunAs -PassThru -Wait
    } catch {
        Write-Error "Administrator approval was not granted: $($_.Exception.Message)"
        exit 1
    }
    exit $elevated.ExitCode
}

$names = @('fKey Playback - Boot Server', 'fKey Playback - Dashboard at Sign-in', 'fKeyLabs Playback')
foreach ($name in $names) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) {
        if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue }
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "Removed: $name"
    }
}
Write-Host 'fKey Playback auto-start has been disabled. Your playlists and data have NOT been deleted.' -ForegroundColor Green