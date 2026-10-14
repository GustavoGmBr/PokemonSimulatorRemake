@echo off
title Pokemon Simulator - Remake
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js 22.13 ou mais novo: https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Primeira execucao: instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar as dependencias.
    pause
    exit /b 1
  )
)

start "" cmd /c "timeout /t 4 >nul && start http://127.0.0.1:35300"
call npm run dev
