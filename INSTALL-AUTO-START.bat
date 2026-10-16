@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo Installing fKey Playback to start automatically after Windows boots...
echo An administrator UAC approval is required to register the boot task.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\register-autostart.ps1" -StartNow
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo Setup failed with code %RESULT%. See the error above.
echo.
pause
exit /b %RESULT%