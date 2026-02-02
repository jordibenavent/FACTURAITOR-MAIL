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


set LOG_FILE=%PROJECT_PATH%setup_log.txt

REM Llamar a PowerShell como administrador
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0\scriptsInstalacion\iis.ps1"


echo Obteniendo la última versión de Node.js...

where node >nul 2>&1
if %errorlevel%==0 (
    echo Node.js ya instalado.
	goto :SKIP_NODE_INSTALL
) 

	REM archivo temporal para recibir la versión desde PowerShell
	set "TMP_VER=%TEMP%\node_latest_ver.txt"
	if exist "%TMP_VER%" del /f /q "%TMP_VER%" >nul 2>&1

	REM Usar Invoke-RestMethod para obtener la primera entrada del index.json
	powershell -NoProfile -Command ^
	  "try { (Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing)[0].version | Out-File -FilePath '%TMP_VER%' -Encoding ASCII } catch { exit 1 }"

	REM Leer la versión desde el fichero
	set "NODE_VERSION="
	if exist "%TMP_VER%" (
	  set /p NODE_VERSION=<"%TMP_VER%"
	  del /f /q "%TMP_VER%" >nul 2>&1
	)

	REM Si NODE_VERSION sigue vacío, intentar obtener la última LTS alternativa
	if "%NODE_VERSION%"=="" (
	  echo No se pudo obtener la version desde index.json. Intentando obtener la ultima LTS...
	  powershell -NoProfile -Command ^
		"try { (Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing | Where-Object { $_.lts } | Select-Object -First 1).version | Out-File -FilePath '%TMP_VER%' -Encoding ASCII } catch { exit 1 }"
	  if exist "%TMP_VER%" (
		set /p NODE_VERSION=<"%TMP_VER%"
		del /f /q "%TMP_VER%" >nul 2>&1
	  )
	)

	REM Si aún no hay versión, abortar con mensaje
	if "%NODE_VERSION%"=="" (
	  echo ERROR: No se pudo determinar la última versión de Node.js.
	  echo Comprueba la conectividad de red o ejecuta manualmente.
	  pause
	  exit /b 1
	)

	echo Última versión detectada: %NODE_VERSION%

	REM Detectar arquitectura y seleccionar MSI apropiado
	if /I "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
	  set "ARCH=x64"
	) else (
	  set "ARCH=x86"
	)

	set "NODE_INSTALLER=node-%NODE_VERSION%-%ARCH%.msi"
	set "NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/%NODE_INSTALLER%"

	echo URL final: %NODE_URL%

	REM Descargar si no existe
	if not exist "%NODE_INSTALLER%" (
	  echo Descargando %NODE_INSTALLER% ...
	  powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_INSTALLER%' -UseBasicParsing } catch { exit 1 }"
	  if %errorlevel% neq 0 (
		echo ERROR: fallo al descargar %NODE_URL%
		pause
		exit /b 1
	  )
	) else (
	  echo Instalador ya existe: %NODE_INSTALLER%
	)

	REM Instalar silenciosamente
	echo Instalando Node.js %NODE_VERSION% ...
	msiexec /i "%NODE_INSTALLER%" /qn /norestart
	if %errorlevel% neq 0 (
	  echo ERROR: msiexec devolvio %errorlevel%
	  pause
	  exit /b 1
	)

echo Node.js instalado correctamente.

:SKIP_NODE_INSTALL


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
        echo AIHOST="http://44.198.229.9:8000"
        echo API_PUBLICA="http://localhost:5000"
        echo APP_PORT="5000"
        echo DOC_PATH="C:\FacturAItor\FacturAItorApp\FacturAItor\custom\documents\"
        echo DB_USER="sa"
        echo DB_PASSWORD="-Instalador0000"
        echo DB_SERVER="localhost"
        echo DB_NAME="Facturaitor_DataBD"
        echo DEBUG="false"
    ) > "%ENV_FILE%"
)

call :editEnv "API_PUBLICA" "http://localhost:5000"
call :editEnv "DOC_PATH" "C:\FacturAItor\FacturAItorApp\FacturAItor\custom\documents\"
call :editEnv "DB_USER" "sa"
call :editEnv "DB_PASSWORD" "-Instalador0000"
call :editEnv "DB_SERVER" "localhost"
call :editEnv "DB_NAME" "Facturaitor_DataBD"
call :editEnv "CONFIG_DB_NAME" "FacturAItorBD"

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
nssm set FacturaitorAPI AppExit Default Restart

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