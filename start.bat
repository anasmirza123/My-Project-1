@echo off
setlocal
title Anas Management System
cd /d "%~dp0"
where node >nul 2>nul || (echo [ERROR] Node.js 18+ is required: https://nodejs.org/ & pause & exit /b 1)
if not exist "node_modules\express" (
  echo [SETUP] Installing dependencies ^(internet needed once^)...
  call npm install || (echo [ERROR] npm install failed. & pause & exit /b 1)
)
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul && (echo [ERROR] Port 3000 is already in use - another copy of the app may be running. Close it first, then start again. & pause & exit /b 1)
start "" /min cmd /c "node diagnose.js --wait-open"
echo Starting at http://localhost:3000 - press Ctrl+C to stop.
call npm start
pause
