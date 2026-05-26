# Recibe el puerto donde está escuchando Node.js para configurar el proxy IIS
param(
    [int]$Port = 5000
)

# Descargar e instalar el módulo URL Rewrite de IIS
powershell -Command "Invoke-WebRequest 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi' -OutFile 'rewrite.msi'"
msiexec /i rewrite.msi /quiet /norestart

# Descargar e instalar Application Request Routing (ARR) para habilitar el proxy inverso
powershell -Command "Invoke-WebRequest 'https://go.microsoft.com/fwlink/?LinkID=615136' -OutFile 'arr.msi'"
msiexec /i arr.msi /quiet /norestart

Import-Module WebAdministration

# Habilitar el proxy en ARR para que IIS pueda redirigir peticiones a Node.js
Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' `
    -filter "system.webServer/proxy" -name "enabled" -value "True"

$apiFolderPath = "C:\facturaitornodeapi"

# Crear la carpeta física que usará IIS como raíz de la aplicación
if (-not (Test-Path $apiFolderPath)) {
    New-Item -Path $apiFolderPath -ItemType Directory
    Write-Host "Carpeta creada en $apiFolderPath"
} else {
    Write-Host "La carpeta ya existe: $apiFolderPath"
}

# Crear la aplicación web "api" en IIS bajo el sitio por defecto
New-WebApplication -Name "api" -Site "Default Web Site" -PhysicalPath "C:\facturaitornodeapi"

# Configurar la regla de reescritura que redirige todas las peticiones
# de http://localhost/api/* hacia Node.js en el puerto indicado
$site = "IIS:\Sites\Default Web Site\api"
$filterRoot = "system.webServer/rewrite/rules/rule[@name='facturaitorapi$_']"
Clear-WebConfiguration -pspath $site -filter $filterRoot
Add-WebConfigurationProperty -pspath $site -filter "system.webServer/rewrite/rules" -name "." -value @{name='facturaitorapi' + $_ ;patternSyntax='Regular Expressions';stopProcessing='False'}
Set-WebConfigurationProperty -pspath $site -filter "$filterRoot/match" -name "url" -value "(.*)"
Set-WebConfigurationProperty -pspath $site -filter "$filterRoot/conditions" -name "logicalGrouping" -value "MatchAny"
Set-WebConfigurationProperty -pspath $site -filter "$filterRoot/action" -name "type" -value "Rewrite"

# Usar el puerto recibido como parámetro en lugar de uno fijo
Set-WebConfigurationProperty -pspath $site -filter "$filterRoot/action" -name "url" -value "http://localhost:$Port/{R:1}"

Write-Host "IIS configurado correctamente. Proxy apuntando al puerto $Port."
