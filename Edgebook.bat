@echo off
title Edgebook
cd /d "%~dp0"

if not exist node_modules (
  echo Installing for the first time. This takes a minute...
  call npm install || goto failed
)
if not exist dist\index.html (
  echo Building the app...
  call npm run build || goto failed
)

start "" /min cmd /c "timeout /t 4 /nobreak >nul & start "" http://localhost:4310"
echo Keep this window open while you use Edgebook. Close it to stop the app.
echo.
call npx tsx server/index.ts

:failed
echo.
pause
