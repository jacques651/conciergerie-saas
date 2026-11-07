@echo off
REM Double-clic pour lancer backend + frontend (contourne la politique d'execution PowerShell)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
