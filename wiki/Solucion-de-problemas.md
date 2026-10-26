# Solución de problemas

Esta página reúne los mensajes y fallos más habituales, sus causas y cómo diagnosticarlos.
Empieza por el aviso que muestra la aplicación: casi todos los errores del proceso principal
se muestran en el bloque rojo de la página correspondiente.

> El panel no guarda registros en disco. El registro de instalación solo vive en memoria y
> se pierde al cerrar la aplicación. Si necesitas conservarlo, cópialo antes de cerrar.

## Primeros auxilios

1. Identifica la sección donde falla: Sitios, PHP, Puertos, Servicios o Instalación.
2. Pulsa **Actualizar** para descartar datos antiguos.
3. Lee el mensaje completo; muchos incluyen el comando o el archivo que falló.
4. Si el fallo es de instalación o DNS, prueba **Reparar instalación** o **Reparar DNS**.
5. Si el problema es de red, usa el modo **Hosts** para no depender del DNS seguro.
6. Si nada funciona, reúne la información de la sección «Cómo reportar un fallo».

## La aplicación no arranca

| Síntoma | Causa probable | Solución |
|---|---|---|
| El AppImage no se ejecuta | Falta permiso de ejecución | `chmod +x "Valet Dashboard-0.1.0.AppImage"` |
| Error de FUSE | Falta `libfuse2` | Instálalo o usa `--appimage-extract-and-run` |
| `The SUID sandbox helper binary was found, but is not configured correctly` | Permisos del sandbox de Electron | Reinstala el paquete o corrige los permisos; no uses `--no-sandbox` de forma permanente |
| La ventana aparece en blanco | Build incompleto o preload no encontrado | Ejecuta `npm run build` o revisa la terminal en desarrollo |
| Se abre pero no hay datos | No hay Valet instalado | Es normal; usa la pestaña **Instalación** |
| No hay menú | El menú se elimina a propósito | Usa la barra de actividad y los atajos |
| Se cierra al cerrar la ventana | Comportamiento normal en Linux | — |

Para ver el error real, ejecuta la app desde una terminal:

```bash
./"Valet Dashboard-0.1.0.AppImage"
```

o, en desarrollo:

```bash
npm run dev
```

## Instalación

### Mensajes del diagnóstico y del preflight

| Mensaje | Causa | Solución |
|---|---|---|
| `Distribución no soportada: <id>. Instala las dependencias a mano.` | `/etc/os-release` no es Debian/Ubuntu, Fedora/RHEL/CentOS ni Arch | Usa una distribución compatible o instala las dependencias manualmente |
| `Falta pkexec (polkit); instálalo para autenticar la instalación.` | No está `pkexec` | Instala `policykit-1` (Debian/Ubuntu) o `polkit` (Fedora/Arch) y comprueba que hay un agente polkit |
| `Falta pkexec (polkit); instálalo para autenticar los cambios de red.` | Igual, al reparar DNS o desinstalar | Igual |
| `Libera los puertos 80/443 antes de instalar: ...` | Otro proceso ocupa los puertos y no es Apache, o no marcaste detener Apache | Detén el proceso o marca la opción de Apache |
| `systemd-resolved no está activo; elige el modo hosts o actívalo antes.` | El modo Seguro necesita systemd-resolved | Actívalo o usa **Hosts** |
| `El puerto 5354 está ocupado; elige el modo hosts.` | dnsmasq u otro proceso usa 5354 | Usa **Hosts** o libera el puerto |
| `Falta dnsmasq; instálalo o usa el modo hosts.` | No hay binario de dnsmasq y el gestor no es apt | Instala dnsmasq o usa **Hosts** |
| `/etc/resolv.conf no apunta a systemd-resolved; elige el modo hosts.` | El archivo no es el enlace al stub `127.0.0.53` | Repara la resolución o usa **Hosts** |
| `No se instaló dnsmasq-base; elige el modo hosts o instálalo a mano.` | El paquete no quedó instalado | Instálalo o usa **Hosts** |
| `Composer no creó el binario valet en el home aislado.` | Falló la descarga, el paquete no contiene `valet` o faltan extensiones PHP | Revisa el registro; corrige la causa y pulsa **Reparar instalación** |
| `No se encontró <ruta>. Composer no instaló el paquete esperado.` | El paquete no tiene la estructura esperada | Usa un paquete compatible, por defecto `cpriego/valet-linux` |
| `No se pudo aplicar el parche DNS seguro; se cancela antes de tocar la red.` | Cambió la estructura de `DnsMasq.php` | Actualiza el panel o usa una versión compatible de Valet |
| `El parche DNS dejó PHP inválido; se restauró el archivo: ...` | El parche produjo un error de sintaxis | El archivo se restauró; reporta el fallo con la versión de Valet |
| `No se pudo verificar valet-dashboard.<dominio>; revisa systemd-resolved o usa el modo hosts.` | El DNS no resuelve el dominio del panel | Diagnostica el DNS o usa **Hosts** |
| `No se pudo ejecutar Valet después de la instalación.` | El binario no está en el `PATH` o no arranca | Revisa el registro y ejecuta el Valet aislado a mano |
| `Valet no creó /usr/local/bin/valet; revisa los permisos de /usr/local/bin.` | Permisos o instalación incompleta | Revisa permisos y pulsa **Reparar instalación** |
| `nginx no está activo. Revisa si otro servicio ocupa los puertos 80/443.` | nginx no arrancó | `systemctl status nginx`, `nginx -t`, revisa puertos |
| `No hay ningún PHP-FPM activo; revisa php-fpm con systemctl.` | No hay servicio PHP-FPM activo | Instala o inicia un `phpX.Y-fpm` |
| `El servicio DNS seguro no está activo.` | Falló `valet-dashboard-dns` | `systemctl status valet-dashboard-dns` y `journalctl` |
| `systemd-resolved no está activo.` | Se detuvo durante la instalación | Actívalo y vuelve a aplicar el DNS |
| `No se pudo resolver valet-dashboard.<dominio>.` | DNS o hosts mal configurados | Usa **Reparar DNS** o **Hosts** |
| `Paquete de Composer no válido (vendor/nombre)` | El campo no tiene formato `vendor/nombre` | Corrige el valor |
| `La carpeta de proyectos debe ser una ruta absoluta` | La ruta no empieza por `/` ni por `~/` | Usa una ruta absoluta o `~/Sites` |
| `Ya hay una operación en curso` | Se lanzó otra instalación mientras corría una | Espera a que termine; no cierres la app |
| `Hay un Valet externo; no se desinstala automáticamente desde el dashboard.` | El Valet detectado no es el aislado | Desinstálalo con su propio método o usa el panel solo con el aislado |

### Errores del gestor de paquetes

| Mensaje | Causa | Solución |
|---|---|---|
| `Could not get lock /var/lib/dpkg/lock-frontend` | Otro `apt`/`apt-get` está en ejecución | Espera o cierra la otra herramienta; no borres el lock a ciegas |
| `Unable to locate package ...` | Índices desactualizados o repositorio no disponible | Ejecuta `apt-get update` o revisa los repositorios |
| `No space left on device` | Disco lleno | Libera espacio y reintenta |
| `Could not resolve host` | Sin Internet o DNS roto | Revisa la red antes de continuar |
| `Transaction check error` / conflictos de `dnf` | Paquetes incompatibles | Resuelve el conflicto con `dnf` y reintenta |
| `target not found` en pacman | Paquete no disponible en los repositorios | Actualiza los repositorios o instala el equivalente |
| Se canceló el diálogo de polkit | No autenticaste | Repite y autentica |

### La instalación falla a medias

El instalador no revierte los paquetes ya instalados ni el paquete de Composer si un paso
posterior falla. Los pasos son idempotentes:

1. Corrige la causa que muestra el registro.
2. Pulsa **Reparar instalación**.
3. Los pasos completados se omiten o se repiten sin duplicar configuración.

No cierres la aplicación durante una operación. Si se queda bloqueada, espera a que el
comando termine; matar el proceso puede dejar paquetes o archivos a medio escribir.

## DNS y resolución de `*.test`

### Comprobaciones básicas

```bash
getent hosts valet-dashboard.test
resolvectl query valet-dashboard.test
resolvectl status
ss -lunp | grep 5354
systemctl status valet-dashboard-dns --no-pager -l
readlink -f /etc/resolv.conf
```

Sustituye `test` por tu dominio de Valet si es distinto.

### El modo Seguro no resuelve

1. Comprueba que el servicio está activo:

   ```bash
   systemctl is-active valet-dashboard-dns
   ```

2. Comprueba que dnsmasq escucha en `127.0.0.1:5354`:

   ```bash
   ss -lunp | grep 5354
   ```

3. Revisa la configuración:

   ```bash
   cat /etc/valet-dashboard/dnsmasq.conf
   cat /etc/systemd/resolved.conf.d/valet-dashboard.conf
   ```

4. Valida y reinicia:

   ```bash
   sudo dnsmasq --test --conf-file=/etc/valet-dashboard/dnsmasq.conf
   sudo systemctl restart valet-dashboard-dns
   sudo systemctl restart systemd-resolved
   resolvectl flush-caches
   ```

5. Si sigue fallando, pulsa **Reparar DNS** con el modo **Seguro**. Si el problema persiste,
   cambia a **Hosts**.

Causas habituales:

- `systemd-resolved` no está activo.
- `/etc/resolv.conf` no apunta al stub.
- Otro proceso ocupa el puerto 5354.
- Una VPN o NetworkManager impone otro DNS.
- El dominio de Valet cambió y la ruta `~<dominio>` quedó antigua.

### El modo Hosts no resuelve un sitio nuevo

El modo **Hosts** no usa comodines: solo resuelve los nombres exactos del bloque gestionado.
Después de `valet park` o `valet link`:

1. Ve a **Instalación**.
2. Pulsa **Sincronizar hosts**.
3. Comprueba el bloque:

   ```bash
   grep -n -A30 'BEGIN VALET DASHBOARD' /etc/hosts
   ```

4. Prueba de nuevo:

   ```bash
   getent hosts mi-sitio.test
   ```

Los subdominios arbitrarios (`api.mi-sitio.test`) no se resuelven en este modo salvo que
estén en el bloque.

Si el archivo de hosts tiene líneas no válidas, el helper falla con
`El archivo de hosts contiene líneas no válidas`. Revisa que las líneas del bloque tengan
el formato `127.0.0.1 nombre`.

### El WiFi o el DNS general dejaron de funcionar

El modo **Seguro** intenta revertir su configuración si falla la resolución. Si el problema
aparece después de usar el modo **Clásico**, el panel no puede deshacer los cambios de
Valet.

Pasos, de menos a más invasivo:

1. Comprueba si Internet resuelve:

   ```bash
   getent hosts example.com
   resolvectl query example.com
   ```

2. Si el DNS del panel es el culpable, desactívalo y restaura la configuración de red desde
   una terminal local:

   ```bash
   sudo systemctl disable --now valet-dashboard-dns
   sudo rm -f /etc/systemd/resolved.conf.d/valet-dashboard.conf
   sudo systemctl daemon-reload
   sudo systemctl restart systemd-resolved
   ```

3. Si el problema viene del modo Clásico, revisa los restos habituales:

   ```text
   /etc/dnsmasq.d/valet
   /opt/valet-linux
   /etc/NetworkManager/conf.d/valet.conf
   ```

   Desactiva el servicio DNS de Valet y restaura los archivos desde la copia
   `~/.valet-dashboard/backups/<fecha>/dns` o desde la copia del sistema. No borres
   `/etc/resolv.conf` sin saber cuál es su destino original.

4. Si no tienes red, usa una TTY local o el modo de recuperación de tu distribución.

> El modo **Clásico** puede detener `systemd-resolved`, reescribir `/etc/resolv.conf` y
> tocar NetworkManager. Por eso no se recomienda para uso diario.

### El dominio de Valet cambió

El panel lee el dominio de `~/.valet/config.json`. Si lo cambias con `valet domain`:

1. Vuelve a cargar **Sitios**.
2. En modo **Hosts**, pulsa **Sincronizar hosts**.
3. En modo **Seguro**, pulsa **Reparar DNS**.
4. Comprueba la resolución con el dominio nuevo.

## Sitios

| Síntoma | Causa | Solución |
|---|---|---|
| **Aún no hay sitios** | No hay rutas aparcadas ni enlaces | `valet park` en la carpeta de proyectos o `valet link` |
| Un sitio no aparece | No es un directorio, el enlace está roto o la ruta no es accesible | Revisa la ruta y pulsa **Actualizar** |
| **Sin coincidencias** | El buscador no coincide con nombre o ruta | Limpia la búsqueda |
| El botón **Abrir** está deshabilitado | El nombre no forma una URL válida (espacios, `@`, etc.) | Renombra el enlace con un nombre de host válido |
| Abre el puerto equivocado | Los puertos guardados no coinciden con nginx | Revisa **Puertos**, guarda y vuelve a intentar |
| El navegador muestra error de conexión | nginx detenido, DNS sin resolver o puerto cerrado | Revisa **Servicios**, DNS y puertos |
| Advertencia de certificado | El navegador no confía en el certificado de Valet | Es habitual; no desactives la verificación TLS |
| 404 | El proyecto no tiene el `index` esperado o la configuración de nginx no apunta bien | Revisa el proyecto y `valet which` |
| 502 / 504 | PHP-FPM caído o versión incorrecta | Inicia el servicio PHP-FPM correcto en **Servicios** |
| Permission denied | Permisos del proyecto | Asegura lectura y ejecución para el usuario de nginx |
| Aparece `parked` y `linked` con el mismo nombre | El enlace tiene prioridad | Usa `valet unlink` o `valet forget` según corresponda |

Comandos útiles:

```bash
cat ~/.valet/config.json
valet paths
valet links
valet which
ls -la ~/.valet/Certificates
```

## PHP

| Síntoma | Causa | Solución |
|---|---|---|
| **No se encontró ningún php-fpm** | No hay binarios `php-fpmX.Y` en `/usr/sbin` o `/usr/bin` | Instala `phpX.Y-fpm` y pulsa **Actualizar** |
| La versión actual aparece vacía | PHP CLI no está instalado o no responde | Instala `php-cli` o el paquete equivalente |
| **Usar esta versión** falla | Valet no encuentra la versión, falla PHP-FPM o se canceló la contraseña | Revisa el mensaje, el servicio FPM y el diálogo de polkit/sudo |
| El sitio da 502 después del cambio | El servicio FPM de la versión nueva no arrancó | `systemctl status phpX.Y-fpm`, `journalctl -u phpX.Y-fpm` |
| No aparece una versión instalada | El binario tiene otro nombre o no está en esas carpetas | Comprueba `ls /usr/sbin/php-fpm* /usr/bin/php-fpm*` |

Comandos:

```bash
php -v
systemctl list-unit-files 'php*-fpm.service'
systemctl status php8.3-fpm --no-pager
```

El panel no permite elegir una versión por sitio. Si necesitas esa función, usa
`valet isolate` desde la terminal; el panel seguirá mostrando la versión global.

## Puertos

| Mensaje | Causa | Solución |
|---|---|---|
| `El puerto X ya está ocupado por ...` | Otro proceso usa el puerto | Identifícalo y deténlo, o elige otro puerto |
| `El puerto X está reservado para ...` | Se intentó usar 53, 67, 68, 123, 5353 o 5354 | Elige otro puerto |
| `HTTP y HTTPS no pueden ser el mismo puerto` | Ambos campos coinciden | Usa puertos distintos |
| `No se encontró la configuración de nginx de Valet. Instala Valet primero.` | No existen archivos de nginx de Valet | Instala Valet |
| `No se encontraron directivas listen que actualizar` | La configuración no tiene los `listen` esperados | Revisa los archivos de nginx |
| `No se pudieron detectar los puertos actuales de Apache ...` | `ports.conf` o los `VirtualHost` no son reconocibles | Revisa la configuración de Apache |
| `nginx rechazó la configuración; se restauró la anterior` | `nginx -t` falló | Lee el error incluido; corrige la configuración |
| `Apache rechazó la configuración; se restauró la anterior` | `apache2ctl configtest` falló | Lee el error incluido; corrige la configuración |
| `El puerto ... está reservado ...` | Validación de puerto web | Usa un puerto no reservado |

Diagnóstico:

```bash
ss -tlnp
ss -tlnp | grep -E ':(80|443)\b'
sudo nginx -t
sudo apache2ctl configtest
systemctl status nginx --no-pager
systemctl status apache2 --no-pager
```

### Los puertos vuelven a 80/443

Valet regenera su configuración al ejecutar `valet install`, `valet secure` o
`valet unsecure`. Después de esas operaciones:

1. Entra en **Puertos**.
2. Pulsa **Actualizar** para detectar los valores reales.
3. Vuelve a guardar tus puertos.

### El sitio no responde en un puerto personalizado

- Abre la URL con el puerto: `http://mi-sitio.test:8080/`.
- Comprueba que nginx escucha en ese puerto con `ss -tlnp`.
- Revisa el cortafuegos: el panel no abre puertos en `ufw`, `firewalld` ni `nftables`.
- Si usas un contenedor o proxy delante, revisa que reenvíe al puerto correcto.

## Servicios

| Síntoma | Causa | Solución |
|---|---|---|
| `Servicio desconocido` | La unidad no está en la lista permitida o desapareció | Pulsa **Actualizar**; usa la terminal si no está soportada |
| No aparece ningún servicio | systemd no está disponible o no hay unidades reconocidas | Comprueba `systemctl list-unit-files`; en contenedores puede no haber systemd |
| Se cancela la acción | Cerraste el diálogo de polkit | Repite y autentica |
| El servicio no arranca | Error de configuración o dependencia | `systemctl status`, `journalctl -u` |
| No puedo habilitarlo al inicio | El panel solo hace start/stop/restart | Usa `systemctl enable` desde la terminal |

```bash
systemctl status nginx --no-pager -l
journalctl -u nginx -b --no-pager
systemctl --failed --no-pager
```

Detener `nginx` deja los sitios sin servicio. Detener `valet-dashboard-dns` rompe la
resolución en modo Seguro. Detener una base de datos desconecta a las aplicaciones que la
usan.

## Ajustes

| Síntoma | Causa | Solución |
|---|---|---|
| Los ajustes no se conservan | `localStorage` no disponible o datos corruptos | Pulsa **Restablecer**; revisa el directorio de datos de Electron |
| La fuente **Otra** no cambia | La familia no está instalada o el nombre no coincide | Usa el nombre exacto del gestor de fuentes |
| El tema no sigue al sistema | Se eligió Claro u Oscuro, o el escritorio no informa del cambio | Selecciona **Sistema** |
| El botón de la barra de estado cambia a un tema fijo | Es su comportamiento | Vuelve a **Sistema** en Ajustes |
| La vista compacta no hace nada visible | Solo reduce rellenos, no el tamaño de texto | Ajusta también el tamaño de texto |
| **Restablecer** no borra todo | No borra el ancho del panel ni datos de Valet | Es intencionado |

Los ajustes están en `localStorage`, no en `~/.valet-dashboard`. Si borras el directorio de
datos de Electron, se restablecen.

## Desinstalación

| Síntoma | Causa | Solución |
|---|---|---|
| **Desinstalar** está deshabilitado | El Valet detectado es externo o no está instalado | Solo se desinstala el Valet aislado del panel |
| Falla al desinstalar | `valet uninstall` falló, se canceló polkit o faltan permisos | Lee el registro y reintenta **Desinstalar** |
| Quedan restos de DNS clásico | El modo Clásico no lo gestiona el panel | Revisa `/etc/dnsmasq.d/valet`, `/opt/valet-linux`, `/etc/NetworkManager/conf.d/valet.conf` |
| Los proyectos siguen ahí | Es intencionado | El panel no borra proyectos ni copias |
| `/usr/local/bin/valet` sigue existiendo | `valet uninstall` no lo retiró | Revisa el resultado de Valet antes de borrarlo a mano |

Después de desinstalar se conservan:

- `~/.valet-dashboard/backups/`
- `~/.valet-dashboard/config.json`
- Los ajustes visuales
- Tus proyectos
- Un Valet externo, si existía

## Limitaciones conocidas

- Solo Linux con `systemd`, `polkit` y, preferiblemente, NetworkManager.
- La instalación automática requiere `apt`, `dnf` o `pacman`.
- No crea ni elimina sitios, enlaces, rutas aparcadas, proxies ni túneles.
- No permite una versión de PHP por sitio desde la interfaz.
- No instala MySQL, MariaDB, PostgreSQL, Redis ni Apache.
- No configura cortafuegos.
- No tiene actualización automática.
- No restaura copias desde la interfaz.
- No muestra un visor de registros.
- No gestiona directamente el almacén de confianza del navegador; `valet secure` puede
  instalar el certificado con `certutil`, pero el panel no lo garantiza.
- El soporte de Apache se limita a la ruta Debian `/etc/apache2`.
- La desinstalación automática solo cubre el Valet aislado del panel.
- No gestiona servicios de usuario ni contenedores.
- La interfaz está solo en español.
- No hay tests automatizados ni CI.

## Comandos de diagnóstico

Estos comandos son de lectura o de validación; no cambian la configuración:

| Para qué | Comando |
|---|---|
| Versión de Valet | `valet --version` |
| Valet aislado | `~/.config/valet-dashboard/composer/vendor/bin/valet --version` |
| Estado global | `systemctl --failed --no-pager` |
| nginx | `systemctl status nginx --no-pager -l` |
| PHP-FPM | `systemctl list-unit-files 'php*-fpm.service'` |
| Puertos TCP | `ss -tlnp` |
| Puerto DNS | `ss -lunp \| grep 5354` |
| resolved | `resolvectl status` |
| Resolución de un sitio | `getent hosts mi-sitio.test` |
| Consulta DNS | `resolvectl query mi-sitio.test` |
| Enlace de resolv.conf | `readlink -f /etc/resolv.conf` |
| Configuración de Valet | `cat ~/.valet/config.json` |
| Configuración de puertos | `cat ~/.valet-dashboard/config.json` |
| Certificados | `ls -la ~/.valet/Certificates` |
| nginx | `sudo nginx -t` |
| Apache | `sudo apache2ctl configtest` |
| DNS del panel | `journalctl -u valet-dashboard-dns -b --no-pager` |
| Copias | `ls -la ~/.valet-dashboard/backups` |
| Espacio | `df -h` |

## Cómo reportar un fallo

El panel no tiene un botón de reporte ni envía datos automáticamente. Si vas a abrir un
issue, incluye:

- Versión del panel (`0.1.0` o la que uses).
- Distribución y versión (`cat /etc/os-release`).
- Entorno de escritorio y si usas Wayland o X11.
- Modo DNS usado.
- Pasos exactos para reproducirlo.
- Mensaje de error completo.
- Registro de la instalación, si aplica (cópialo antes de cerrar).
- Salida de:

  ```bash
  valet --version
  systemctl status nginx --no-pager
  systemctl status valet-dashboard-dns --no-pager
  ss -tlnp
  getent hosts valet-dashboard.test
  ```

- Si el fallo es de puertos, la salida de `nginx -t` o `apache2ctl configtest`.

Oculta nombres de usuario, rutas privadas, tokens y datos de red antes de publicar.

## Relacionado

- [Instalación](Instalacion)
- [Sitios](Sitios)
- [PHP](PHP)
- [Puertos](Puertos)
- [Servicios](Servicios)
- [Seguridad y copias](Seguridad-y-copias)
