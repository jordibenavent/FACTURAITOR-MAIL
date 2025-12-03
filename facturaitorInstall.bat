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
REM EDITAR .env CON PREGUNTAS
REM ================================
set ENV_FILE=%PROJECT_PATH%.env

echo.
echo =========================================
echo Configuración del archivo .env
echo =========================================

REM Crear archivo si no existe
if not exist "%ENV_FILE%" (
    echo Creando .env.base...
    (
        echo API="http://localhost:5000"
        echo AIHOST="http://44.198.229.9:8000"
        echo API_PUBLICA="http://localhost:5000"
        echo WEBHOOK_URL="/v1/job-reply"
        echo DOC_PATH="C:\FacturAItor\FacturAItorApp\FacturAItor\custom\documents\"
        echo DB_USER=
        echo DB_PASSWORD=
        echo DB_SERVER="localhost"
        echo DB_NAME="Facturaltor_DataBD"
        echo DEBUG=false
    ) > "%ENV_FILE%"
)

call :editEnv "API" "http://localhost:5000"
call :editEnv "DB_USER" ""
call :editEnv "DB_PASSWORD" ""
call :editEnv "DB_SERVER" "localhost"
call :editEnv "DB_NAME" "Facturaltor_DataBD"


REM ================================
REM CREAR SERVICIO DE WINDOWS CON NSSM
REM ================================
echo.
echo =========================================
echo Creando servicio de Windows con NSSM...
echo =========================================

set PROJECT_DIR=%~dp0
set APP_ENTRY=src/index.js
set SERVICE_NAME=FacturaitorAPI



echo Instalando servicio: FacturaitorAPI...

REM Crear el servicio base
nssm install FacturaitorAPI "C:\Program Files\nodejs\node.exe" 

REM Establecer el directorio de trabajo del servicio
nssm set FacturaitorAPI AppDirectory "%PROJECT_DIR:~0,-1%"
nssm set FacturaitorAPI AppParameters src\index.js
REM Configurar inicio automático
nssm set FacturaitorAPI Start SERVICE_AUTO_START

REM Configurar reinicio automático si hay fallo
nssm set FacturaitorAPI AppRestartDelay 5000
nssm set FacturaitorAPI AppThrottle 2000
nssm set %FacturaitorAPI AppExit Default Restart

REM Iniciar servicio
echo Iniciando el servicio...
nssm start FacturaitorAPI

echo =========================================
echo Servicio instalado y ejecutándose.
echo Nombre del servicio: FacturaitorAPI
echo =========================================

echo =========================================
echo Instalación y configuración completadas.
pause
goto :main_end


REM ================================
REM FUNCIÓN PARA EDITAR CLAVES DEL ENV
REM ================================
:editEnv
setlocal ENABLEDELAYEDEXPANSION
set "KEY=%~1"
set "DEFAULT=%~2"
set "CURRENT_LINE="
set "CURRENT_VALUE="

REM Obtener la línea completa exacta
for /f "usebackq delims=" %%L in ("%ENV_FILE%") do (
    echo %%L | findstr /b "%KEY%=" >nul
    if not errorlevel 1 (
        set "CURRENT_LINE=%%L"
        REM Extraer solo el valor después del primer "="
        for /f "tokens=1,* delims==" %%A in ("%%L") do (
            set "CURRENT_VALUE=%%B"
        )
    )
)

REM Si no existe en el archivo, usar valor por defecto
if "!CURRENT_LINE!"=="" (
    set "CURRENT_VALUE=%DEFAULT%"
    set "CURRENT_LINE=%KEY%=%DEFAULT%"
)

echo.
echo Valor actual de %KEY%: !CURRENT_VALUE!
set /p "INPUT=Nuevo valor (Enter para mantener): "

REM Determinar el nuevo valor
if "!INPUT!"=="" (
    set "NEW_VALUE=%KEY%=!CURRENT_VALUE!"
) else (
    set "NEW_VALUE=%KEY%=!INPUT!"
)

REM Reescribir el archivo línea por línea
(
    for /f "usebackq delims=" %%L in ("%ENV_FILE%") do (
        echo %%L | findstr /b "%KEY%=" >nul
        if not errorlevel 1 (
            echo !NEW_VALUE!
        ) else (
            echo %%L
        )
    )
) > "%ENV_FILE%.tmp"

move /Y "%ENV_FILE%.tmp" "%ENV_FILE%" >nul

endlocal

:main_end