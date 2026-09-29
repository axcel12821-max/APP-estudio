@echo off
title Focusly - agenda diaria
cd /d "%~dp0"
echo.
echo   Focusly esta abierto en http://localhost:5173
echo   Deja esta ventana abierta mientras usas la app (podes minimizarla).
echo.
start "" http://localhost:5173
python -m http.server 5173 --bind 127.0.0.1
if errorlevel 1 (
  echo.
  echo   No se pudo iniciar el servidor. Si ya esta abierto en otra ventana, usa esa.
  echo   Si falta Python, instalalo desde https://www.python.org
  pause
)
