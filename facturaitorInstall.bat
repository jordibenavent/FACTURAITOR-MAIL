@echo off
setlocal enabledelayedexpansion

REM ================================
REM COMPROBAR PERMISOS DE ADMINISTRADOR
REM ================================
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

set PROJECT_DIR=%~dp0
set LOG_FILE=%PROJECT_DIR%setup_log.txt
set ENV_FILE=%PROJECT_DIR%.env


REM ================================
REM COMPROBAR SI YA ESTÁ INSTALADO
REM Si existe el .env la aplicación ya fue instalada anteriormente.
REM Para evitar sobreescribir la configuración del cliente se cancela la instalación.
REM ================================
if exist "%ENV_FILE%" (
    echo.
    echo =========================================
    echo La aplicacion ya esta instalada.
    echo Si necesita reinstalar, elimine el archivo
    echo .env y vuelva a ejecutar el instalador.
    echo =========================================
    echo.
    pause
    exit /b 0
)


REM ================================
REM DETERMINAR EL PUERTO DE INSTALACIÓN
REM Comprueba si el puerto 5000 está libre.
REM Si está ocupado pide al usuario que introduzca otro puerto
REM y valida que también esté libre antes de continuar.
REM ================================
set CHOSEN_PORT=5000

:CHECK_PORT
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %CHOSEN_PORT% -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if %errorlevel%==1 (
    echo.
    echo =========================================
    echo El puerto %CHOSEN_PORT% esta en uso por otra aplicacion.
    echo Introduce otro puerto para instalar FacturAItor.
    echo =========================================
    set /p CHOSEN_PORT=Puerto:
    goto CHECK_PORT
)

echo.
echo Puerto %CHOSEN_PORT% disponible. Se usara para la instalacion.
echo.


REM ================================
REM INSTALAR NODE.JS SI NO ESTÁ INSTALADO
REM ================================
where node >nul 2>&1
if %errorlevel%==0 (
    echo Node.js ya esta instalado.
    goto :SKIP_NODE_INSTALL
)

echo Obteniendo la ultima version de Node.js...

set "TMP_VER=%TEMP%\node_latest_ver.txt"
if exist "%TMP_VER%" del /f /q "%TMP_VER%" >nul 2>&1

powershell -NoProfile -Command ^
  "try { (Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing)[0].version | Out-File -FilePath '%TMP_VER%' -Encoding ASCII } catch { exit 1 }"

set "NODE_VERSION="
if exist "%TMP_VER%" (
    set /p NODE_VERSION=<"%TMP_VER%"
    del /f /q "%TMP_VER%" >nul 2>&1
)

if "%NODE_VERSION%"=="" (
    echo No se pudo obtener la version desde index.json. Intentando LTS...
    powershell -NoProfile -Command ^
        "try { (Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing | Where-Object { $_.lts } | Select-Object -First 1).version | Out-File -FilePath '%TMP_VER%' -Encoding ASCII } catch { exit 1 }"
    if exist "%TMP_VER%" (
        set /p NODE_VERSION=<"%TMP_VER%"
        del /f /q "%TMP_VER%" >nul 2>&1
    )
)

if "%NODE_VERSION%"=="" (
    echo ERROR: No se pudo determinar la ultima version de Node.js.
    echo Comprueba la conectividad de red o instala Node.js manualmente.
    pause
    exit /b 1
)

echo Ultima version detectada: %NODE_VERSION%

if /I "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    set "ARCH=x64"
) else (
    set "ARCH=x86"
)

set "NODE_INSTALLER=node-%NODE_VERSION%-%ARCH%.msi"
set "NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/%NODE_INSTALLER%"

if not exist "%NODE_INSTALLER%" (
    echo Descargando %NODE_INSTALLER%...
    powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_INSTALLER%' -UseBasicParsing } catch { exit 1 }"
    if %errorlevel% neq 0 (
        echo ERROR: fallo al descargar %NODE_URL%
        pause
        exit /b 1
    )
)

echo Instalando Node.js %NODE_VERSION%...
msiexec /i "%NODE_INSTALLER%" /qn /norestart
if %errorlevel% neq 0 (
    echo ERROR: fallo al instalar Node.js
    pause
    exit /b 1
)

echo Node.js instalado correctamente.

:SKIP_NODE_INSTALL


REM ================================
REM INSTALAR DEPENDENCIAS NPM
REM ================================
echo.
echo Instalando dependencias del proyecto...
cd /d "%PROJECT_DIR%"
call npm install >> "%LOG_FILE%" 2>&1
if %errorlevel% neq 0 (
    echo.
    echo =========================================
    echo ERROR: npm install fallo.
    echo Revisa el archivo setup_log.txt para ver los detalles.
    echo =========================================
    pause
    exit /b 1
)
echo Dependencias instaladas.


REM ================================
REM CREAR ARCHIVO .env
REM APP_PORT y API_PUBLICA se establecen automáticamente con el puerto validado.
REM El resto de valores se preguntarán al usuario a continuación.
REM ================================
echo.
echo =========================================
echo Configuracion del archivo .env
echo =========================================
(
    echo AIHOST="http://44.198.229.9:8000"
    echo API_PUBLICA="http://localhost:%CHOSEN_PORT%"
    echo APP_PORT="%CHOSEN_PORT%"
    echo DOC_PATH="C:\FacturAItor\FacturAItorApp\FacturAItor\custom\documents\"
    echo DB_USER="sa"
    echo DB_PASSWORD="-Instalador0000"
    echo DB_SERVER="localhost"
    echo DB_NAME="Facturaitor_DataBD"
    echo CONFIG_DB_NAME="FacturAItorBD"
    echo DEBUG="false"
) > "%ENV_FILE%"

REM Preguntar al usuario los valores específicos de su instalación.
REM APP_PORT y API_PUBLICA no se preguntan, ya están configurados con el puerto validado.
call :editEnv "DOC_PATH" "C:\FacturAItor\FacturAItorApp\FacturAItor\custom\documents\"
call :editEnv "DB_USER" "sa"
call :editEnv "DB_PASSWORD" "-Instalador0000"
call :editEnv "DB_SERVER" "localhost"
call :editEnv "DB_NAME" "Facturaitor_DataBD"
call :editEnv "CONFIG_DB_NAME" "FacturAItorBD"


REM ================================
REM VERIFICAR SQL SERVER BROWSER
REM Las instancias SQL con nombre (ej: servidor\instancia) requieren
REM que SQL Server Browser esté activo para resolver el nombre de instancia.
REM Si no está corriendo la conexión falla con un error confuso.
REM ================================
set "DB_SERVER_VAL="
for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    if /i "%%A"=="DB_SERVER" set "DB_SERVER_VAL=%%B"
)
set DB_SERVER_VAL=%DB_SERVER_VAL:"=%

echo %DB_SERVER_VAL% | findstr /C:"\" >nul 2>&1
if %errorlevel%==0 (
    echo.
    echo Instancia SQL con nombre detectada (%DB_SERVER_VAL%).
    echo Verificando SQL Server Browser...
    powershell -NoProfile -Command ^
        "$svc=Get-Service -Name 'SQLBrowser' -ErrorAction SilentlyContinue;" ^
        "if($null -eq $svc){Write-Host 'AVISO: SQL Server Browser no esta instalado. Las instancias con nombre pueden no conectar.'}" ^
        "elseif($svc.Status -ne 'Running'){Write-Host 'SQL Server Browser detenido. Iniciando...'; Start-Service SQLBrowser; Set-Service SQLBrowser -StartupType Automatic; Write-Host 'SQL Server Browser iniciado y configurado como automatico.'}" ^
        "else{Write-Host 'SQL Server Browser en ejecucion. OK.'}"
)


REM ================================
REM CONFIGURAR PUERTO EN BASE DE DATOS
REM Inserta o actualiza el parámetro PuertoIIS en la tabla Configuracion
REM para que el procedimiento pPers_ReiniciarCuentas sepa a qué puerto
REM llamar sin tener el valor hardcodeado en el código del procedimiento.
REM Así Flexygo puede actualizar el procedimiento sin perder este valor.
REM ================================
echo.
echo Configurando puerto en base de datos...

set "DB_USER_VAL="
set "DB_PASSWORD_VAL="
set "DB_NAME_VAL="
for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    if /i "%%A"=="DB_USER"     set "DB_USER_VAL=%%B"
    if /i "%%A"=="DB_PASSWORD" set "DB_PASSWORD_VAL=%%B"
    if /i "%%A"=="DB_NAME"     set "DB_NAME_VAL=%%B"
)
set DB_USER_VAL=%DB_USER_VAL:"=%
set DB_PASSWORD_VAL=%DB_PASSWORD_VAL:"=%
set DB_NAME_VAL=%DB_NAME_VAL:"=%

set "INSTALL_DB_SERVER=%DB_SERVER_VAL%"
set "INSTALL_DB_USER=%DB_USER_VAL%"
set "INSTALL_DB_PASSWORD=%DB_PASSWORD_VAL%"
set "INSTALL_DB_NAME=%DB_NAME_VAL%"


REM ================================
REM CONFIGURAR IIS
REM Se pasa el puerto elegido como parámetro para que el proxy
REM redirija correctamente las peticiones a Node.js.
REM ================================
echo.
echo Configurando IIS...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%scriptsInstalacion\iis.ps1" -Port %CHOSEN_PORT%


REM ================================
REM GUARDAR PUERTO IIS EN BASE DE DATOS
REM Se detecta el puerto real en que escucha IIS (puede ser 80, 8080 u otro)
REM y se guarda en Configuracion.PuertoIIS para que pPers_ReiniciarCuentas
REM construya la URL correcta sin tener el puerto hardcodeado.
REM ================================
echo.
echo Detectando puerto de IIS...
set "IIS_PORT=80"
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "(Get-WebBinding -Name 'Default Web Site' -ErrorAction SilentlyContinue | Select-Object -First 1).bindingInformation.Split(':')[1]"`) do set "IIS_PORT=%%P"
echo Puerto IIS detectado: %IIS_PORT%

echo Configurando puerto en base de datos...
set "INSTALL_PORT=%IIS_PORT%"

powershell -NoProfile -Command ^
    "$s=$env:INSTALL_DB_SERVER; $d=$env:INSTALL_DB_NAME; $u=$env:INSTALL_DB_USER; $p=$env:INSTALL_DB_PASSWORD; $port=$env:INSTALL_PORT;" ^
    "$connStr='Server='+$s+';Database='+$d+';User Id='+$u+';Password='+$p+';TrustServerCertificate=True;';" ^
    "try {" ^
    "  $conn=New-Object System.Data.SqlClient.SqlConnection($connStr); $conn.Open();" ^
    "  $cmd=$conn.CreateCommand();" ^
    "  $sql='IF EXISTS(SELECT 1 FROM Configuracion WHERE Parametro=''PuertoIIS'') UPDATE Configuracion SET ValorString='''+$port+''',FechaInsertUpdate=GETDATE() WHERE Parametro=''PuertoIIS'' ELSE INSERT INTO Configuracion(Parametro,ValorString)VALUES(''PuertoIIS'','''+$port+''')';" ^
    "  $cmd.CommandText=$sql; $cmd.ExecuteNonQuery()|Out-Null; $conn.Close();" ^
    "  Write-Host ('Puerto IIS '+$port+' guardado en base de datos. OK.')" ^
    "} catch {" ^
    "  Write-Host ('AVISO: No se pudo guardar el puerto en BD: '+$_.Exception.Message);" ^
    "  Write-Host ('Ejecute manualmente: INSERT INTO Configuracion(Parametro,ValorString)VALUES(''PuertoIIS'','''+$port+''')')" ^
    "}"


REM ================================
REM CREAR SERVICIO WINDOWS CON NSSM
REM ================================
echo.
echo =========================================
echo Creando servicio de Windows con NSSM...
echo =========================================

set SERVICE_NAME=FacturaitorAPI

nssm install %SERVICE_NAME% "C:\Program Files\nodejs\node.exe"
nssm set %SERVICE_NAME% AppDirectory "%PROJECT_DIR:~0,-1%"
nssm set %SERVICE_NAME% AppParameters src\index.js

REM Inicio automático con Windows
nssm set %SERVICE_NAME% Start SERVICE_AUTO_START

REM Reinicio automático si la aplicación falla
nssm set %SERVICE_NAME% AppRestartDelay 5000
nssm set %SERVICE_NAME% AppThrottle 2000
nssm set %SERVICE_NAME% AppExit Default Restart

echo Iniciando el servicio...
nssm start %SERVICE_NAME%

echo.
echo =========================================
echo Instalacion completada correctamente.
echo Servicio: %SERVICE_NAME%
echo Puerto:   %CHOSEN_PORT%
echo =========================================
echo.
pause
goto :main_end


REM ================================
REM FUNCIÓN PARA EDITAR CLAVES DEL .env
REM Muestra el valor actual de cada clave y permite al usuario
REM cambiarlo o mantenerlo pulsando Enter.
REM ================================
:editEnv
setlocal ENABLEDELAYEDEXPANSION
set "KEY=%~1"
set "DEFAULT=%~2"
set "CURRENT_LINE="
set "CURRENT_VALUE="

REM Buscar el valor actual de la clave en el .env
for /f "usebackq delims=" %%L in ("%ENV_FILE%") do (
    echo %%L | findstr /b "%KEY%=" >nul
    if not errorlevel 1 (
        set "CURRENT_LINE=%%L"
        for /f "tokens=1,* delims==" %%A in ("%%L") do (
            set "CURRENT_VALUE=%%B"
        )
    )
)

REM Si la clave no existe en el archivo usar el valor por defecto
if "!CURRENT_LINE!"=="" (
    set "CURRENT_VALUE=%DEFAULT%"
    set "CURRENT_LINE=%KEY%=%DEFAULT%"
)

echo.
echo Valor actual de %KEY%: !CURRENT_VALUE!
set /p "INPUT=Nuevo valor (Enter para mantener): "

if "!INPUT!"=="" (
    set "NEW_VALUE=%KEY%=!CURRENT_VALUE!"
) else (
    set "NEW_VALUE=%KEY%=!INPUT!"
)

REM Reescribir el .env sustituyendo solo la línea de esta clave
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
goto :eof

:main_end
