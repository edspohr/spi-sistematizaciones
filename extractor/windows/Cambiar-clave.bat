@echo off
chcp 65001 >nul
title InvimÁgil Base - Cambiar clave
set "AQUI=%~dp0"
set PYTHONUTF8=1
"%AQUI%python\python.exe" "%AQUI%app\generar_base.py" --cambiar-clave
