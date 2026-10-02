@echo off
cd /d "%~dp0"
powershell -NoProfile -File scripts\setup-local.ps1
pause
