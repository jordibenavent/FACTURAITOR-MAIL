@echo off
setlocal

REM ================================
REM COMPROBAR Y SOLICITAR PERMISOS DE ADMINISTRADOR
REM ================================
@echo off
REM Intentar acceder a una ruta protegida (requiere admin)
net session >nul 2>&1
if %errorlevel% neq 0 (
 echo.
 echo =========================================
 echo Se requieren privilegios de administrador.
 echo Mostrando solicitud de permisos...
 echo =========================================
 echo.
 powershell -Command "Start-Process '%~f0' -Verb RunAs"
 exit /b
)



REM ================================
REM CONFIGURACIÓN
REM ================================
set NODE_VERSION=latest-v22.x
set NODE_INSTALLER=node-v22.20.0-x64.msi
set NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/%NODE_INSTALLER%
set PROJECT_PATH=%~dp0
set LOG_FILE=%PROJECT_PATH%setup_log.txt
set PM2_PATH=%APPDATA%\npm\pm2.cmd
set TASK_NAME=PM2_Startup

echo =========================================
echo Instalando Node.js y configurando PM2
echo =========================================
echo Log: %LOG_FILE%
echo ========================================= >> "%LOG_FILE%"

REM ================================
REM DESCARGAR E INSTALAR NODEJS
REM ================================
if not exist "%NODE_INSTALLER%" (
echo Descargando Node.js...
powershell -Command "Invoke-WebRequest '%NODE_URL%' -OutFile '%NODE_INSTALLER%'" >> "%LOG_FILE%" 2>&1
)

echo Instalando Node.js %NODE_VERSION%...
msiexec /i "%NODE_INSTALLER%" /qn /norestart ADDLOCAL=ALL >> "%LOG_FILE%" 2>&1

REM ================================
REM ESPERAR DISPONIBILIDAD DE NPM
REM ================================
echo Esperando a que npm esté disponible...
set RETRIES=0

where node >nul 2>nul
if %errorlevel% neq 0 (
set /a RETRIES+=1
if %RETRIES% geq 10 (
echo Node.js no se encontró en el PATH. Revisa la instalación.
exit /b 1
)
timeout /t 5 >nul
goto WAIT_NODE
)

echo Node.js instalado correctamente.
echo ========================================= >> "%LOG_FILE%"

REM ================================
REM INSTALAR DEPENDENCIAS
REM ================================
cd /d "%PROJECT_PATH%"
echo Instalando dependencias del proyecto...
call npm install >> "%LOG_FILE%" 2>&1

REM ================================
REM INSTALAR PM2 Y CONFIGURAR
REM ================================
echo Instalando PM2 globalmente...
call npm install -g pm2 >> "%LOG_FILE%" 2>&1

echo Iniciando aplicación con PM2...
REM Cambia "app.js" y "mi-app" según tu proyecto
call pm2 start src/index.js --name "Facturaitor" >> "%LOG_FILE%" 2>&1

echo Guardando estado de PM2...
call pm2 save >> "%LOG_FILE%" 2>&1

REM ================================
REM CREAR TAREA PROGRAMADA DE ARRANQUE
REM ================================
echo Creando tarea programada para restaurar PM2 al inicio del sistema...
schtasks /Query /TN "%TASK_NAME%" >nul 2>&1
if %errorlevel%==0 (
echo Eliminando tarea anterior...
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1
)

REM Crear una tarea que se ejecute al inicio, con privilegios elevados, incluso sin iniciar sesión
schtasks /Create ^
/SC ONSTART ^
/TN "%TASK_NAME%" ^
/RL HIGHEST ^
/RU "SYSTEM" ^
/TR ""%PM2_PATH%" resurrect" >> "%LOG_FILE%" 2>&1

if %errorlevel%==0 (
echo Tarea de PM2 creada correctamente.
) else (
echo ERROR: No se pudo crear la tarea programada. Revisa permisos o ejecuta este script como Administrador.
)

echo =========================================
echo Instalación y configuración completadas.
echo El proceso PM2 se restaurará automáticamente al iniciar el sistema.
pause
endlocal