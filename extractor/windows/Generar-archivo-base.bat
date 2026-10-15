@echo off
chcp 65001 >nul
title InvimÁgil Base
set "AQUI=%~dp0"
set PYTHONUTF8=1
set PYTHONDONTWRITEBYTECODE=1
rem Alternativa al clic derecho: arrastre la carpeta del producto sobre este archivo.
"%AQUI%python\python.exe" "%AQUI%app\generar_base.py" %1
