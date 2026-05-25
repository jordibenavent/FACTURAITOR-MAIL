
powershell -Command "Invoke-WebRequest 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi' -OutFile 'rewrite.msi'"
msiexec /i rewrite.msi /quiet /norestart


powershell -Command "Invoke-WebRequest 'https://go.microsoft.com/fwlink/?LinkID=615136' -OutFile 'arr.msi'"
msiexec /i arr.msi /quiet /norestart

Import-Module WebAdministration

# Habilitar proxy en ARR
Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' `
    -filter "system.webServer/proxy" -name "enabled" -value "True"

$apiFolderPath = "C:\facturaitornodeapi"

# Crear carpeta si no existe
if (-not (Test-Path $apiFolderPath)) {
    New-Item -Path $apiFolderPath -ItemType Directory
    Write-Host "Carpeta creada en $apiFolderPath"
} else {
    Write-Host "La carpeta ya existe: $apiFolderPath"
}

# Crear nueva aplicación en IIS
New-WebApplication -Name "api" -Site "Default Web Site" -PhysicalPath "C:\facturaitornodeapi"

$site = "IIS:\Sites\Default Web Site\api"
$filterRoot = "system.webServer/rewrite/rules/rule[@name='facturaitorapi$_']"
Clear-WebConfiguration -pspath $site -filter $filterRoot
Add-WebConfigurationProperty -pspath $site -filter "system.webServer/rewrite/rules" -name "." -value @{name='facturaitorapi' + $_ ;patternSyntax='Regular Expressions';stopProcessing='False'}
Set-WebConfigurationProperty -pspath $site -filter "$filterRoot/match" -name "url" -value "(.*)"
Set-WebConfigurationProperty -pspath $site -filter "$filterRoot/conditions" -name "logicalGrouping" -value "MatchAny"
Set-WebConfigurationProperty -pspath $site -filter "$filterRoot/action" -name "type" -value "Rewrite"
Set-WebConfigurationProperty -pspath $site -filter "$filterRoot/action" -name "url" -value "http://localhost:5000/{R:1}"
