#Requires -Version 5.1
# Open only the operator dashboard after the boot service becomes healthy.
[CmdletBinding()]
param([ValidateRange(1, 65535)] [int] $Port = 4177)
$ErrorActionPreference = 'Stop'
$healthUrl = "http://127.0.0.1:$Port/api/health"
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
        if ($health.ok -eq $true -and $health.app -eq 'fKey Playback') {
            Start-Process -FilePath "http://127.0.0.1:$Port/control"
            exit 0
        }
    } catch {
        # The network stack / Playback may still be starting after sign-in.
    }
    Start-Sleep -Seconds 2
}
exit 1