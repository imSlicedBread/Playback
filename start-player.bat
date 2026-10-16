@echo off
setlocal EnableExtensions
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.13 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
set NODE_ENV=production
node server.js
if errorlevel 1 (
  echo.
  echo Playback could not start. See the error above.
  pause
)
endlocal