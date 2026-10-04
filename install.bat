@echo off
setlocal EnableExtensions
title mpeasy - Instalador
cd /d "%~dp0"
set "PYURL=https://www.python.org/ftp/python/3.13.12/python-3.13.12-amd64.exe"
set "HOSTDIR=%~dp0host"
set "MAN=%~dp0host\com.ytmp4.host.json"
set "MANFF=%~dp0host\com.ytmp4.host.firefox.json"
echo.
echo  mpeasy - Instalador
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
echo.
echo  [1/5] Conectando con los navegadores
"%PY%" "%HOSTDIR%\setup.py" --files
if errorlevel 1 goto failed
if not exist "%MAN%" goto failed
for %%K in ("Google\Chrome" "Microsoft\Edge" "BraveSoftware\Brave-Browser" "Chromium" "Vivaldi") do reg add "HKCU\Software\%%~K\NativeMessagingHosts\com.ytmp4.host" /ve /t REG_SZ /d "%MAN%" /f >nul
reg add "HKCU\Software\Mozilla\NativeMessagingHosts\com.ytmp4.host" /ve /t REG_SZ /d "%MANFF%" /f >nul
reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytmp4.host" >nul 2>nul
if errorlevel 1 goto noreg
echo        Chrome, Edge, Brave, Opera, Vivaldi y Firefox.
"%PY%" "%HOSTDIR%\setup.py"
set "CODE=%errorlevel%"
echo.
pause
exit /b %CODE%

:failed
echo.
echo  ERROR: no se pudieron crear los archivos del programa local en:
echo  %HOSTDIR%
echo  Descomprime el zip en una carpeta normal, por ejemplo C:\YT MP4, y vuelve a abrir install.bat.
echo.
pause
exit /b 1

:noreg
echo.
echo  ERROR: Windows no dejo registrar el programa en los navegadores.
echo  Cierra esta ventana, haz clic derecho en install.bat y elige "Ejecutar como administrador".
echo.
pause
exit /b 1

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
