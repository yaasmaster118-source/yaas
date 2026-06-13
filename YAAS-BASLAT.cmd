@echo off
title YAAS Yerel Sunucu
cd /d "%~dp0"

:start
cls
echo YAAS calisiyor: http://localhost:4173/
echo Bu pencere acik kaldigi surece site calisir.
echo.
"C:\Program Files\nodejs\node.exe" server.js
echo.
echo YAAS durdu. 2 saniye icinde yeniden baslatiliyor...
timeout /t 2 /nobreak >nul
goto start
