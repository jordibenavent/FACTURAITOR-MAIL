# Guía: Despliegue de FacturAItor-Mail en nuevo cliente

**Fecha:** 27/05/2026  
**Versión del instalador:** con detección de puerto dinámica y configuración automática de BD

---

## Requisitos previos en el servidor del cliente

Antes de ejecutar el instalador el servidor debe tener:

| Requisito | Motivo |
|-----------|--------|
| Windows Server con **IIS instalado y activo** | El script configura IIS pero no lo instala |
| **SQL Server** en ejecución | La app necesita conectarse a dos bases de datos existentes |
| Bases de datos creadas: `Facturaitor_DataBD` y `FacturAItorBD` | El instalador no las crea, solo se conecta a ellas |
| Tabla `Configuracion` existente en `Facturaitor_DataBD` | El instalador escribe el parámetro `PuertoIIS` en esta tabla |
| Acceso a internet desde el servidor | Para descargar Node.js y módulos de IIS durante la instalación |
| Acceso al servidor IA `http://44.198.229.9:8000` | Host externo donde corre la IA que procesa las facturas |

---

## Preparar el paquete de despliegue

La carpeta comprimida debe contener estos ficheros. **No incluir** `node_modules/`, `.env`, `src/temp/`, `src/logs/`, `.git/`:

```
facturaitorInstall.bat
nssm.exe
package.json
package-lock.json
scriptsInstalacion/
    iis.ps1
src/
    index.js
    db.js
    utilities.js
    logger-setup.js
    api/
        api.js
        middlewares/auth.js
        v1/v1.js
```

Si el zip viene directamente de GitHub ya tiene la estructura correcta.

---

## Pasos de instalación

### Paso 1 — Copiar y extraer en el servidor

- Copiar el zip al servidor (escritorio remoto, pendrive, etc.)
- Extraer en una ruta **sin espacios ni caracteres especiales**. Ejemplo: `C:\FacturAitorMail\`
- Evitar rutas con paréntesis como `FacturAItorMail(Jordi)` — causan problemas en PowerShell

### Paso 2 — Ejecutar el instalador como administrador

Clic derecho sobre `facturaitorInstall.bat` → **Ejecutar como administrador**

El instalador hace automáticamente:
1. Comprueba si ya está instalado (si existe `.env` cancela para no sobreescribir)
2. Detecta si el puerto 5000 está libre; si no, pide otro puerto
3. Instala Node.js si no está instalado
4. Ejecuta `npm install`
5. Crea el archivo `.env` con los valores base
6. Pregunta los valores de configuración del cliente
7. Verifica SQL Server Browser si la instancia SQL tiene nombre (`servidor\instancia`)
8. Inserta el parámetro `PuertoIIS` en la tabla `Configuracion` de SQL Server
9. Configura IIS (descarga ARR y URL Rewrite, reinicia IIS, crea proxy)
10. Crea el servicio Windows `FacturaitorAPI` con NSSM

### Paso 3 — Responder las preguntas de configuración

El instalador pregunta estos valores (pulsar Enter para mantener el valor por defecto):

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DOC_PATH` | Ruta donde se guardan las facturas | `C:\FlexygoApp\Facturaltor\documents\` |
| `DB_USER` | Usuario SQL Server | `sa` |
| `DB_PASSWORD` | Contraseña SQL Server | la contraseña del cliente |
| `DB_SERVER` | Servidor SQL | `localhost` o `servidor\instancia` |
| `DB_NAME` | Base de datos de datos | `Facturaitor_DataBD` |
| `CONFIG_DB_NAME` | Base de datos de configuración | `FacturAItorBD` |

`APP_PORT` y `API_PUBLICA` no se preguntan — se configuran automáticamente con el puerto elegido.

---

## Verificación post-instalación

1. Abrir navegador en el servidor y acceder a `http://localhost/api/health`  
   Debe responder: `{"status":"ok","msg":"API activa"}`

2. En Servicios de Windows (`services.msc`) el servicio `FacturaitorAPI` debe aparecer como **En ejecución**

3. Ejecutar el procedimiento SQL `pPers_ReiniciarCuentas` desde SQL Server Management Studio  
   Debe devolver: `{"msg":"Se están reiniciando los buzones"}`

---

## Actualización del procedimiento SQL tras el despliegue

El procedimiento `pPers_ReiniciarCuentas` debe estar actualizado para leer el puerto desde la tabla `Configuracion` en lugar de tenerlo hardcodeado. Esto permite que Flexygo actualice el procedimiento en todos los clientes sin perder la configuración de puerto de cada instalación.

Si el procedimiento no está actualizado aún, consultar con el coordinador del proyecto para aplicar la versión actualizada que incluye la lectura de `Configuracion WHERE Parametro='PuertoIIS'`.

---

## Problemas conocidos y soluciones

### IIS devuelve 404 en `/api/health` pero Node.js funciona en `localhost:PUERTO`

**Causa:** El puerto de IIS en este servidor no es el 80 estándar.

**Diagnóstico:**
```powershell
Get-WebBinding -Name "Default Web Site" | Select-Object bindingInformation
```
Si devuelve `*:8080:` (o cualquier puerto distinto de 80), IIS escucha en ese puerto.

**Solución:** Usar `http://localhost:PUERTO_IIS/api/health` para verificar. El procedimiento SQL usa el proxy de IIS, por lo que la URL en `pPers_ReiniciarCuentas` debe incluir ese puerto. Con la versión actualizada del procedimiento que lee `PuertoIIS` desde `Configuracion`, esto ya no es necesario — el instalador configura el valor correcto automáticamente.

---

### Servicio `FacturaitorAPI` en estado PAUSADO

**Causa más habitual:** `npm install` no se ejecutó correctamente y faltan las dependencias de Node.js.

**Solución:**
```cmd
cd C:\FacturAitorMail
npm install
net stop FacturaitorAPI
net start FacturaitorAPI
```

---

### Error de conexión SQL para instancias con nombre (`servidor\instancia`)

**Causa:** SQL Server Browser está deshabilitado. Este servicio es necesario para resolver el nombre de instancia.

**Solución manual** (si el instalador no lo hizo automáticamente):
1. Abrir `services.msc`
2. Buscar **SQL Server Browser**
3. Propiedades → Tipo de inicio: **Automático**
4. Iniciar el servicio

---

### Error "El elemento de destino ya existe" al configurar IIS

**Causa:** La aplicación `/api` ya existía en IIS de una instalación anterior. El instalador actualizado ya comprueba esto, pero en instalaciones anteriores al 27/05/2026 podía ocurrir.

**Solución:** El instalador actualizado maneja este caso automáticamente. Para instalaciones antiguas, eliminar la aplicación `/api` en IIS Manager y volver a ejecutar `iis.ps1`.

---

### ARR no aparece en IIS Manager ("Application Request Routing Cache" no existe)

**Causa:** ARR se instaló pero IIS no se reinició para cargar el módulo.

**Solución:**
```cmd
iisreset /restart
```
Cerrar y volver a abrir IIS Manager. A partir de la versión del instalador del 27/05/2026 esto se hace automáticamente.

---

## Lecciones aprendidas — primer despliegue (cliente ecomaria, 27/05/2026)

- IIS estaba en puerto **8080** en lugar del 80 estándar → la URL `http://localhost/api/health` nunca llegaba a IIS
- SQL Server era una instancia con nombre (`ecomaria\SQLAHORA`) → SQL Server Browser estaba deshabilitado
- `npm install` falló silenciosamente → el servicio arrancó en estado PAUSADO sin mensaje de error claro
- ARR se instaló pero no se cargó en IIS hasta el reinicio → `Application Request Routing Cache` no aparecía en IIS Manager
- Todas estas incidencias quedaron resueltas en el instalador a partir de esta fecha
