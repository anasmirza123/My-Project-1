@echo off
setlocal
title Customer CRM & Order Tracking System
cd /d "%~dp0"

echo.
echo  ========================================================
echo    Customer Management ^& Order Tracking System (Local)
echo  ========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] Node.js is not installed. Install Node.js 18 or newer from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  [SETUP] First run: installing dependencies ^(needs internet once^)...
    call npm install
    if errorlevel 1 (
        echo  [ERROR] npm install failed. Check your internet connection and try again.
        pause
        exit /b 1
    )
)

echo  Starting at http://localhost:3000  -  press Ctrl+C to stop.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
call npm start
pause
