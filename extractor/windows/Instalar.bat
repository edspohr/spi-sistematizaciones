@echo off
chcp 65001 >nul
title InvimÁgil Base - Instalación
set "AQUI=%~dp0"
set PYTHONUTF8=1
set PYTHONDONTWRITEBYTECODE=1
"%AQUI%python\python.exe" "%AQUI%app\generar_base.py" --instalar
