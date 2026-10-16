@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo Disabling fKey Playback Windows boot startup...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\unregister-autostart.ps1"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo Uninstall failed with code %RESULT%. See the error above.
echo.
pause
exit /b %RESULT%