# Incidencia: Cuentas de correo no se actualizaban tras modificar tabla Cuentas

**Fecha:** 25/05/2026  
**Estado:** Resuelto  

---

## Descripción del problema

Al modificar las credenciales de acceso de las cuentas de correo en la tabla SQL `Cuentas`, la aplicación seguía conectándose con las credenciales antiguas. Esto ocurría porque el objeto en memoria con los datos de conexión IMAP nunca se actualizaba.

---

## Causa raíz

La aplicación carga las cuentas de correo en memoria al arrancar (`startMailboxes()` en `src/index.js`). Para forzar una recarga sin reiniciar el servicio existe un mecanismo: el procedimiento SQL `pPers_ReiniciarCuentas` llama al endpoint HTTP `GET /v1/restart-accounts`, que ejecuta `startMailboxes(true)` para recargar las cuentas desde la base de datos.

Este mecanismo **no funcionaba** por dos fallos encadenados:

### Fallo 1 — Puerto incorrecto en el procedimiento SQL

El procedimiento llamaba a `http://localhost:5000/v1/restart-accounts` pero la aplicación Node.js estaba instalada en el **puerto 6000** (el 5000 estaba ocupado en este servidor). La llamada HTTP nunca llegaba a la aplicación.

La aplicación usa IIS como proxy inverso. El archivo `web.config` en `C:\facturaitornodeapi\` tenía configurado el reenvío al puerto 6000. La URL correcta para llamar a través de IIS es `http://localhost/api/v1/restart-accounts`, que funciona independientemente del puerto que use Node.js en cada instalación.

**Corrección aplicada en** `pPers_ReiniciarCuentas`:
```sql
-- Antes (puerto hardcodeado, incorrecto en este servidor):
DECLARE @URL NVARCHAR(MAX) = N'http://localhost:5000/v1/restart-accounts';

-- Después (usa el proxy IIS, válido para cualquier instalación):
DECLARE @URL NVARCHAR(MAX) = N'http://localhost/api/v1/restart-accounts';
```

### Fallo 2 — Función no implementada en el endpoint Node.js

Aunque se corrigiera el puerto, el endpoint `/v1/restart-accounts` en `src/api/v1/v1.js` llamaba a `checkAuthorityAPI()`, una función que **no está definida ni importada en ningún sitio del proyecto**. Node.js lanzaba un `ReferenceError` y devolvía HTTP 500 antes de ejecutar el reinicio. El procedimiento SQL no detectaba este error porque `sp_OA*` no lanza excepciones para respuestas 4xx/5xx.

**Corrección aplicada en** `src/api/v1/v1.js`:
```js
// PENDIENTE: checkAuthorityAPI() está llamada aquí pero no está definida ni importada en ningún sitio del proyecto.
// Comentado para que el endpoint funcione hasta que se implemente la validación de licencia.
// const isAuthorized = await checkAuthorityAPI();
// if(!isAuthorized){
//     return res.status(403).json({ error: 'Licencia inválida' });
// }
```

> **Nota para el desarrollador:** La función `checkAuthorityAPI()` parece una validación de licencia que quedó pendiente de implementar. Revisar con quien desarrolló esta parte.

---

## Pasos para aplicar los cambios en producción

1. Modificar el procedimiento SQL `pPers_ReiniciarCuentas` con la nueva URL.
2. Modificar `src/api/v1/v1.js` comentando el bloque de `checkAuthorityAPI`.
3. Reiniciar el servicio Windows para que Node.js cargue el nuevo código:
   ```cmd
   net stop FacturaitorAPI
   net start FacturaitorAPI
   ```
4. Verificar ejecutando el procedimiento desde SQL Server — debe devolver `{"msg":"Se están reiniciando los buzones"}`.

---

## Verificación

- Se ejecutó el procedimiento `pPers_ReiniciarCuentas` desde SQL Server.
- Respuesta recibida: `{"msg":"Se están reiniciando los buzones"}` ✓
- Los logs del servicio confirmaron que se conectó a las cuentas actualizadas ✓

---

## Otros hallazgos durante el análisis

- El script de instalación `scriptsInstalacion/iis.ps1` configuraba el proxy IIS apuntando siempre al puerto 5000 sin posibilidad de cambiarlo. **Corregido** (ver sección mejoras del instalador).
- La variable `APP_PORT` del archivo `.env` define el puerto de Node.js para cada instalación. Tenerla en cuenta al instalar en nuevos servidores.

---

## Mejoras aplicadas al instalador (26/05/2026)

Durante el análisis de la incidencia se detectó que el instalador `facturaitorInstall.bat` tenía el puerto 5000 hardcodeado en tres sitios, lo que causaba fallos en servidores donde ese puerto estaba ocupado. Se corrigió el instalador con la siguiente lógica:

**Nuevo flujo del instalador:**
1. Si ya existe el archivo `.env` → avisa que la aplicación ya está instalada y cancela para no sobreescribir la configuración del cliente.
2. Comprueba si el puerto 5000 está libre.
3. Si está ocupado → pide al usuario otro puerto y lo valida hasta encontrar uno libre.
4. Crea el `.env` con `APP_PORT` y `API_PUBLICA` usando el puerto validado automáticamente.
5. Llama a `iis.ps1` pasándole el puerto como parámetro.

**Ficheros modificados:**
- `facturaitorInstall.bat` — lógica de detección y validación de puerto
- `scriptsInstalacion/iis.ps1` — acepta el puerto como parámetro `-Port` en lugar de tenerlo fijo

---

## Cambios subidos a GitHub

| Fecha | Commit | Descripción |
|-------|--------|-------------|
| 25/05/2026 | `merge: resolver conflictos manteniendo version local con fixes aplicados` | Fix checkAuthorityAPI y mejoras Node.js |
| 26/05/2026 | `fix: instalador detecta puerto en uso y configura IIS dinamicamente` | Mejoras en el instalador |

Repositorio: https://github.com/jordibenavent/FACTURAITOR-MAIL.git  
Rama: `main`
