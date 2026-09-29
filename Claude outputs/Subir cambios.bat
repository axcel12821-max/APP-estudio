@echo off
title Focusly - subir cambios a GitHub
cd /d "%~dp0"
echo.
where git >nul 2>nul
if errorlevel 1 (
  echo   No encuentro Git. Instalalo desde https://git-scm.com y volve a intentar.
  pause
  exit /b 1
)
echo   Cambios pendientes:
echo   ------------------
git status --short
echo.
git diff --quiet
set CAMBIOS=%errorlevel%
git diff --cached --quiet
if errorlevel 1 set CAMBIOS=1
for /f %%i in ('git ls-files --others --exclude-standard') do set CAMBIOS=1
if "%CAMBIOS%"=="0" (
  echo   No hay cambios para subir. Igual reviso si hay algo nuevo en GitHub...
  git pull --rebase origin main
  pause
  exit /b 0
)
set "MSG="
set /p MSG=  Describi el cambio (Enter = "Actualizacion Focusly"): 
if "%MSG%"=="" set "MSG=Actualizacion Focusly"
echo.
git add -A
git commit -m "%MSG%"
if errorlevel 1 goto error
echo.
echo   Trayendo lo ultimo de GitHub antes de subir...
git pull --rebase origin main
if errorlevel 1 goto error
echo.
echo   Subiendo a main...
git push origin HEAD:main
if errorlevel 1 goto error
echo.
echo   Listo! Los cambios ya estan en GitHub (main).
echo.
pause
exit /b 0
:error
echo.
echo   Algo fallo (mira el mensaje de arriba). No se perdio nada: tus archivos siguen igual.
echo   Si dice "conflict", avisale a Claude antes de tocar nada.
echo.
pause
exit /b 1
