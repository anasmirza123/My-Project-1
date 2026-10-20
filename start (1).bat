@echo off
title Garment Management System
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nahi mila. Pehle https://nodejs.org se install karein.
  echo.
  pause
  exit /b 1
)
echo Garment Management System start ho raha hai...
echo Browser mein yeh address khulega: http://localhost:3003
echo (Is window ko band na karein, warna app band ho jayegi.)
echo.
node server.js
echo.
echo Server band ho gaya.
pause
