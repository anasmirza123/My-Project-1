@echo off
rem Stops the app if it is running in the background (port 3000). Closing the start.bat window does the same.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do (
  taskkill /PID %%a /F >nul 2>nul
  echo Customer Manager stopped.
  goto :done
)
echo The app was not running.
:done
pause
