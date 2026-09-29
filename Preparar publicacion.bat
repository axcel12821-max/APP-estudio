@echo off
title Focusly - preparar publicacion
cd /d "%~dp0"
echo.
echo   Armando la carpeta "publicar" con los archivos de la app...
if exist publicar rmdir /s /q publicar
mkdir publicar
copy /y index.html publicar\ >nul
copy /y styles.css publicar\ >nul
copy /y sw.js publicar\ >nul
copy /y manifest.webmanifest publicar\ >nul
copy /y _headers publicar\ >nul
xcopy js publicar\js\ /e /i /q /y >nul
xcopy assets publicar\assets\ /e /i /q /y >nul
echo.
echo   Listo. Ahora:
echo     1. Entra a https://app.netlify.com/drop (con tu cuenta iniciada)
echo     2. Arrastra la carpeta "publicar" a la pagina.
echo   Para actualizar despues: tu sitio en Netlify ^> Deploys ^> arrastra de nuevo la carpeta.
echo.
explorer publicar
pause
