#Requires -Version 5.1
$taskNames = @('fKey Playback - Boot Server', 'fKey Playback - Dashboard at Sign-in', 'fKeyLabs Playback')
foreach ($name in $taskNames) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) {
        $info = Get-ScheduledTaskInfo -TaskName $name
        Write-Host "$name : $($task.State) (last result: $($info.LastTaskResult))"
        Write-Host "  Last run: $($info.LastRunTime)"
        Write-Host "  Next run: $($info.NextRunTime)"
    } else {
        Write-Host "$name : Not installed"
    }
}
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4177/api/health' -TimeoutSec 2
    Write-Host "Server health: $($health.app) $($health.version), uptime $($health.uptimeSeconds)s" -ForegroundColor Green
} catch {
    Write-Host 'Server health: No response on port 4177 (or configured with a different port)' -ForegroundColor Yellow
}