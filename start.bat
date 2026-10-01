@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terpasang. Instal Node.js 22.12+ atau 24 LTS.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm run dev -- --open
pause
