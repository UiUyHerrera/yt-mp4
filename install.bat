@echo off
setlocal EnableExtensions
title YT MP4 - Instalador
cd /d "%~dp0"
set "PYURL=https://www.python.org/ftp/python/3.13.12/python-3.13.12-amd64.exe"
echo.
echo  YT MP4 - Instalador
echo.
call :findpy
if defined PY goto havepy
echo  Python no esta instalado. Descargando Python 3.13 (unos 28 MB)...
set "PYSETUP=%TEMP%\ytmp4-python-setup.exe"
curl.exe -L --fail --silent --show-error -o "%PYSETUP%" "%PYURL%"
if not exist "%PYSETUP%" powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing '%PYURL%' -OutFile '%PYSETUP%'"
if not exist "%PYSETUP%" goto nopy
echo  Instalando Python (puede tardar un minuto)...
"%PYSETUP%" /quiet InstallAllUsers=0 InstallLauncherAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0 Include_doc=0
del "%PYSETUP%" >nul 2>nul
call :findpy
if not defined PY goto nopy
:havepy
echo  Python: %PY%
"%PY%" "%~dp0host\setup.py"
set "CODE=%errorlevel%"
echo.
pause
exit /b %CODE%

:nopy
echo.
echo  No se pudo instalar Python automaticamente.
echo  Instalalo desde https://www.python.org/downloads/ marcando "Add python.exe to PATH"
echo  y vuelve a abrir install.bat.
echo.
pause
exit /b 1

:findpy
set "PY="
for /f "usebackq delims=" %%P in (`py -3 -c "import sys; print(sys.executable) if sys.version_info >= (3, 10) else None" 2^>nul`) do if exist "%%P" set "PY=%%P"
if defined PY exit /b 0
for /f "usebackq delims=" %%P in (`python -c "import sys; print(sys.executable) if sys.version_info >= (3, 10) else None" 2^>nul`) do if exist "%%P" set "PY=%%P"
if defined PY exit /b 0
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PY=%%D\python.exe"
exit /b 0
