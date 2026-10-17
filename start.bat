@echo off
setlocal
title Customer CRM - Local Server
cd /d "%~dp0"

echo.
echo  ================================
echo    Customer Management System
echo  ================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo  ERROR: Node.js is not installed or not on PATH.
    echo  Install Node.js 18+ from https://nodejs.org/ then run this again.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  Installing dependencies ^(first run only^)...
    call npm install
    if errorlevel 1 (
        echo  ERROR: npm install failed.
        pause
        exit /b 1
    )
)

echo.
echo  Starting server at http://localhost:3000
echo  Press Ctrl+C to stop.
echo.

start "" "http://localhost:3000"
node server.js

pause
