@echo off
setlocal
title Customer CRM & Order Tracking System
cd /d "%~dp0"

echo.
echo  ========================================================
echo    Customer Management & Order Tracking System (Local)
echo  ========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] Node.js is not found on your system PATH.
    echo  Please install Node.js 18 or newer from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  [SETUP] Installing dependencies for first-time setup...
    call npm install
    if errorlevel 1 (
        echo  [ERROR] npm install encountered an error.
        pause
        exit /b 1
    )
)

echo.
echo  Starting local server at http://localhost:3000 ...
echo  Press Ctrl+C to safely stop the server.
echo.

start "" "http://localhost:3000"
call npm start

pause
