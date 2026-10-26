# Puertos

La pestaña **Puertos** permite cambiar los puertos HTTP/HTTPS de **Valet (nginx)** y de
**Apache**, y muestra qué procesos están escuchando y si hay conflictos.

## Valet · nginx

### Campos y presets

- **HTTP**: puerto para tráfico sin cifrar.
- **HTTPS**: puerto para tráfico cifrado.
- Presets:
  - `80 / 443`
  - `8080 / 8443`

Al entrar en la pestaña, los campos se rellenan con los puertos detectados en la
configuración real de nginx.

### Validaciones

Antes de guardar:

- Ambos valores deben ser enteros entre 1 y 65535.
- HTTP y HTTPS no pueden ser iguales.
- No se permiten puertos reservados:
  - `53` (DNS)
  - `67` y `68` (DHCP)
  - `123` (NTP)
  - `5353` (mDNS/Avahi)
  - `5354` (DNS seguro del panel)
- Los puertos nuevos deben estar libres o pertenecer a nginx.
- La configuración actual debe tener puertos distintos para HTTP y HTTPS.

### Qué hace al guardar

1. Detecta los puertos actuales en todos los archivos de nginx:
   - `~/.valet/Nginx/*.conf`
   - `/etc/nginx/sites-available/valet.conf`
2. Sustituye las directivas `listen` que usan el par actual por el par nuevo.
3. Guarda una copia de cada archivo modificado en
   `~/.valet-dashboard/backups/<fecha>/nginx/`.
4. Valida con `nginx -t` (con permisos elevados).
5. Si nginx estaba activo, lo recarga; si estaba detenido, lo inicia.
6. Guarda los puertos en `~/.valet-dashboard/config.json`.

Si algo falla:

- Se restauran los archivos originales.
- Se intenta recargar nginx con la configuración anterior.
- El error se muestra en el aviso de la página.

### Errores habituales

| Mensaje | Causa |
|---|---|
| `El puerto X ya está ocupado por ...` | Otro proceso usa ese puerto |
| `El puerto X está reservado para ...` | Se intentó usar un puerto reservado |
| `HTTP y HTTPS no pueden ser el mismo puerto` | Ambos campos tienen el mismo valor |
| `No se encontró la configuración de nginx de Valet. Instala Valet primero.` | No existen archivos de configuración de Valet |
| `No se encontraron directivas listen que actualizar` | La configuración no contiene los puertos esperados |
| `nginx rechazó la configuración; se restauró la anterior` | `nginx -t` falló y se revirtieron los cambios |

### Detección de los puertos actuales

El panel no confía solo en lo último guardado: lee las directivas `listen` de los archivos
de nginx. Si no encuentra nada, usa los valores guardados en
`~/.valet-dashboard/config.json` o los valores por defecto 80/443.

## Apache

La tarjeta de Apache solo aparece con contenido si existe `/etc/apache2/ports.conf`.
El soporte está orientado a Apache de Debian/Ubuntu; no se gestionan las rutas de `httpd`
de otras distribuciones.

### Estados

- **no instalado**: no existe `/etc/apache2`.
- **activo**: el servicio `apache2` está en ejecución.
- **detenido (arranca al inicio)**: está habilitado pero no activo.
- **detenido**: no está activo ni habilitado.

### Campos y presets

- **HTTP** y **HTTPS**, con las mismas validaciones de rango, igualdad y puertos
  reservados que nginx.
- Presets `8080 / 8443` y `80 / 443`.
- **Guardar y recargar Apache**: valida y aplica los cambios.
- **Detener Apache** / **Iniciar Apache**: usa `systemctl` a través de `pkexec`.

### Qué hace al guardar

1. Lee `/etc/apache2/ports.conf` y los archivos de `sites-enabled`.
2. Detecta los puertos actuales a partir de `Listen` y de los `VirtualHost`.
3. Sustituye los puertos en `Listen` y en las etiquetas `<VirtualHost ...:puerto>` de
   `ports.conf`, `sites-enabled` y `sites-available`.
4. Guarda copias en `~/.valet-dashboard/backups/<fecha>/apache/`.
5. Valida con `apache2ctl configtest`.
6. Si Apache estaba activo, lo recarga. Si estaba detenido, no lo arranca.
7. Guarda los puertos en `~/.valet-dashboard/config.json`.

Si `apache2ctl configtest` falla, se restauran los archivos y se recarga la configuración
anterior si el servicio estaba activo.

> Mover Apache a 8080/8443 es útil cuando ocupa 80/443 y quieres que Valet use los puertos
> estándar. También puedes detenerlo desde esta misma tarjeta.

## Puertos en escucha

La tabla inferior muestra los puertos TCP en escucha obtenidos con `ss -tlnpH`:

- Puerto.
- Nombre conocido, si lo hay:
  - `53` → DNS (dnsmasq)
  - `80` → HTTP
  - `443` → HTTPS
  - `3306` → MySQL
  - `5354` → DNS seguro (Valet Dashboard)
  - `6379` → Redis
- Proceso y PID, si están disponibles.
- Etiqueta **Valet** si el puerto es uno de los configurados para Valet y lo usa nginx.
- Etiqueta **choca con Valet** si el puerto es de Valet pero lo usa otro proceso.

La barra superior de la sección indica cuántos puertos están en escucha y cuántos
conflictos hay.

### Cómo se calcula un conflicto

Un puerto se marca como conflicto si:

- Está entre los puertos configurados de Valet (HTTP o HTTPS), y
- El proceso que lo usa no es nginx.

Cuando el proceso no se puede leer (`—`) pero nginx está activo y el puerto es de Valet,
el panel asume que es nginx y no lo marca como conflicto.

## Puertos personalizados y sitios

- El botón **Abrir** de la pestaña [Sitios](Sitios) construye la URL con el puerto real de
  nginx, así que funciona aunque hayas cambiado los puertos.
- Si abres la URL a mano, debes incluir el puerto:
  `http://mi-proyecto.test:8080/` o `https://mi-proyecto.test:8443/`.
- Cambiar los puertos de nginx no cambia el DNS.
- Cambiar los puertos no abre ni cierra el cortafuegos del sistema; si un firewall bloquea
  el puerto, tendrás que permitirlo por separado.

## Efecto de otras operaciones

Valet puede regenerar sus archivos de nginx al ejecutar:

- `valet install`
- `valet secure`
- `valet unsecure`
- Una reinstalación o reparación desde el panel

En esos casos, los puertos personalizados pueden volver a 80/443. Después de esas
operaciones, vuelve a **Puertos** y guarda de nuevo tu configuración. El panel detecta los
puertos reales y te muestra cuáles están activos.

## Limitaciones

- Solo gestiona nginx de Valet y Apache de Debian/Ubuntu.
- No gestiona reglas de cortafuegos (`ufw`, `firewalld`, `nftables`).
- No crea redirecciones ni proxies.
- No muestra puertos UDP (el diagnóstico de DNS consulta `ss -lun` aparte).
- No reinicia servicios que dependan de los puertos cambiados, salvo nginx o Apache.
- No permite cambiar los puertos del DNS seguro (5354 es fijo y reservado).

## Diagnóstico rápido

```bash
ss -tlnp
nginx -t
apache2ctl configtest
systemctl status nginx --no-pager
systemctl status apache2 --no-pager
```

Si el panel revierte un cambio, revisa el mensaje de error: normalmente incluye la salida
de `nginx -t` o `apache2ctl configtest`.
