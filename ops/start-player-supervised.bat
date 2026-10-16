@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."
set NODE_ENV=production
:restart
node server.js
set CODE=%ERRORLEVEL%
if %CODE% EQU 0 exit /b 0
echo Playback exited with %CODE% -- restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto restart