@echo off
setlocal
cd /d "%~dp0"
title Customer Manager (close this window to stop the app)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Download the LTS version from https://nodejs.org , install it, then run start.bat again.
  pause
  exit /b 1
)

for /f %%v in ('node -p "+process.versions.node.split(/[.]/)[0]"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
  echo Your Node.js is version %NODEMAJOR%. This app needs version 22 or newer.
  echo Download the LTS version from https://nodejs.org , install it, then run start.bat again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing components. This needs internet ONE time...
  call npm install --omit=dev
  if errorlevel 1 (
    echo Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo Starting... your browser will open in a moment.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
node src\server.js
echo.
echo The app has stopped.
pause
