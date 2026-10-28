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
| `Faltan requisitos: <lista>` | Queda algún requisito bloqueante | Sigue la guía del panel **Requisitos previos** |
| `Falta un método de elevación: instala polkit (pkexec) o sudo con zenity` | No hay `pkexec` ni `sudo` con diálogo | Instala `policykit-1`/`polkit` o `sudo` + `zenity` |
| `Falta zenity o kdialog: sin ellos nadie puede escribir la contraseña de administrador.` | El diálogo de contraseña no existe | Instala `zenity` (o `kdialog` en KDE) |
| `No se encontró pkexec` | El binario desapareció a mitad de la instalación | Revisa la guía y vuelve a comprobar |
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

El panel no te deja a solas con la salida cruda: traduce estas firmas a un título, una
explicación y los comandos que suelen resolverlo. Los comandos aparecen con botón **Copiar**.

| Mensaje | Causa | Solución |
|---|---|---|
| `Could not get lock /var/lib/dpkg/lock-frontend` | Otro `apt`/`apt-get` está en ejecución | Espera o cierra la otra herramienta; no borres el lock a ciegas |
| `Unable to locate package ...` | Índices desactualizados o repositorio no disponible | Ejecuta `apt-get update` o revisa los repositorios |
| `No space left on device` | Disco lleno | Libera espacio y reintenta |
| `Could not resolve host` | Sin Internet o DNS roto | Revisa la red antes de continuar |
| `Transaction check error` / conflictos de `dnf` | Paquetes incompatibles | Resuelve el conflicto con `dnf` y reintenta |
| `target not found` en pacman | Paquete no disponible en los repositorios | Actualiza los repositorios o instala el equivalente |
| Se canceló el diálogo de polkit | No autenticaste | Repite y autentica |
| `El comando no terminó a tiempo` | Superó los 15 minutos | Comprueba la red, espera a que el gestor termine y reintenta |

### La instalación falla a medias

El instalador no revierte los paquetes ya instalados ni el paquete de Composer si un paso
posterior falla. Los pasos son idempotentes:

1. Corrige la causa que muestra el registro.
2. Pulsa **Reparar instalación**.
3. Los pasos completados se omiten o se repiten sin duplicar configuración. El paso de
   dependencias consulta qué falta antes de tocar el gestor, así que el reintento es
   rápido cuando los paquetes ya están.

No cierres la aplicación durante una operación. Si necesitas pararla, usa **Cancelar**:
detiene el comando actual y devuelve la interfaz. Lo que ya se ejecutó con permisos de
administrador puede tardar unos segundos en terminar; espera antes de reintentar para no
dejar el gestor de paquetes bloqueado.

### La prueba de humo falla

El último paso crea un sitio temporal y pide su `index.php` por HTTP. Según la respuesta:

| Respuesta | Significado | Qué revisar |
|---|---|---|
| `200` con `valet-ok` | nginx, PHP-FPM y permisos correctos | Nada |
| `502` | nginx responde, PHP-FPM no | `systemctl status phpX.Y-fpm`, el socket en `~/.valet/` y el pool en `/etc/php/X.Y/fpm/pool.d/valet.conf` |
| `404` | nginx no encuentra el sitio | La configuración de Valet, `valet park` y `~/.valet/Nginx` |
| `000` o vacío | nginx no escucha | `systemctl status nginx`, `nginx -t` y el puerto HTTP configurado |

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
| **Nuevo proyecto** está deshabilitado | Falta Composer o Valet, o el formulario no es válido | Revisa el aviso del diálogo e instala lo que falte |
| El proyecto se creó pero la página da 500 | Faltan extensiones PHP (por ejemplo, `pdo_sqlite`) o `APP_KEY` | Revisa `storage/logs/laravel.log` e instala la extensión que falte |
| El proyecto se creó pero el dominio no resuelve | En modo Hosts no se sincronizaron las entradas | Pulsa **Sincronizar hosts** en **Instalación** |

Comandos útiles:

```bash
cat ~/.valet/config.json
valet paths
valet links
valet which
ls -la ~/.valet/Certificates
```

## Crear proyectos Laravel

El diálogo **Nuevo proyecto** valida los datos en el proceso principal y ejecuta Composer
con el `COMPOSER_HOME` aislado. El registro en vivo muestra el error completo cuando algo
falla.

| Mensaje | Causa | Solución |
|---|---|---|
| `Composer no está instalado. Instálalo desde la pestaña Instalación.` | El binario `composer` no está en el `PATH` | Instálalo desde **Instalación** o corrige el `PATH` |
| `Valet no está instalado. Instálalo desde la pestaña Instalación.` | El binario `valet` no está disponible | Instálalo desde **Instalación** |
| `Nombre de proyecto no válido...` | Mayúsculas, espacios, guiones al inicio/fin o más de 63 caracteres | Usa minúsculas, números y guiones |
| `La carpeta debe ser una ruta absoluta o empezar por ~/.` | La ruta es relativa | Escribe `/home/usuario/Sites` o `~/Sites` |
| `La carpeta de destino no existe.` | La ruta no existe | Créala o elígela con **Elegir…** |
| `La ruta de destino no es una carpeta.` | La ruta apunta a un archivo | Elige un directorio |
| `La carpeta de destino no tiene permisos de escritura.` | El usuario no puede escribir | Corrige permisos o elige otra carpeta |
| `La carpeta ~/.valet/Sites está reservada para los enlaces de Valet.` | Se eligió el directorio interno de enlaces como carpeta de proyectos | Elige una ruta aparcada o cualquier otra carpeta |
| `Ya existe /ruta/<nombre>. Elige otro nombre o carpeta.` | La carpeta de destino ya existe | Cambia el nombre o la carpeta; no se sobrescribe nada |
| `Ya existe un sitio llamado <nombre>.` | Hay un sitio de Valet con ese nombre | Cambia el nombre o elimina el enlace anterior con `valet unlink` |
| `No se encontró el instalador de Laravel ni Composer` | Faltan ambos binarios | Instala Composer desde **Instalación** |
| `No se pudo instalar el instalador de Laravel (código X)` | Fallo de red o de permisos en el Composer aislado | Revisa el registro y la conexión |
| `SQLite no está disponible: falta su extensión PDO en PHP.` | PHP no tiene `pdo_sqlite` | Instala la extensión o elige otro motor |
| `No se encontró <gestor> en el sistema.` | El gestor de Node elegido no está en el `PATH` | Instálalo o elige otro |
| `Faltan las credenciales de la base de datos.` | Motor distinto de SQLite sin credenciales | Completa host, puerto, base, usuario y contraseña |
| `El instalador de Laravel terminó con código X.` | Fallo de red, extensión PHP o migración | Corrige la causa que muestra el registro y reintenta |
| `El instalador de Laravel superó el tiempo máximo...` | La descarga o la compilación de assets no terminó en el tiempo permitido | Revisa la conexión y reintenta |
| `El proyecto se creó en ... pero no se pudo enlazar en Valet: ...` | `valet link` falló | Entra en la carpeta y ejecuta `valet link <nombre>` a mano |
| `El proyecto se creó en ... pero no aparece en la lista de Valet.` | El enlace no existe o la ruta no es accesible | Pulsa **Actualizar**, revisa `valet links` y enlaza a mano si falta |
| `Ya hay una creación de proyecto en curso.` | Se intentó crear otro proyecto mientras el instalador trabajaba | Espera a que termine o pulsa **Detener** |
| `No se pudo ejecutar Composer: ...` | Composer no arrancó o no tiene permisos | Revisa la instalación de Composer |
| `Composer could not find a composer.json` o error de download | Red, proxy o repositorio de Composer | Revisa la conexión y el registro; reintenta |
| `No space left on device` | Disco lleno | Libera espacio y reintenta |
| `could not find driver` en `laravel.log` | Falta la extensión de la base de datos (por ejemplo, SQLite) | Instala `php-sqlite3` o cambia `DB_CONNECTION`/`SESSION_DRIVER` |

### El proyecto no aparece después de crearlo

1. Comprueba que el instalador terminó sin error en el diálogo.
2. Pulsa **Actualizar** en **Sitios**.
3. Revisa el enlace:

   ```bash
   valet links
   ls -la ~/.valet/Sites
   ```

4. Si la carpeta de destino no era una ruta aparcada, debe existir un enlace en
   `~/.valet/Sites/<nombre>`. Si no existe, créalo:

   ```bash
   cd /ruta/al/proyecto
   valet link <nombre>
   ```

5. En modo **Hosts**, sincroniza las entradas:

   ```bash
   getent hosts <nombre>.test
   ```

   Si no resuelve, pulsa **Sincronizar hosts** en **Instalación**.

### El proyecto se creó pero la página falla

El panel solo crea el esqueleto de Laravel; no instala extensiones PHP ni configura la base
de datos. Un error 500 nada más abrir suele venir de Laravel, no de Valet:

```bash
cd /ruta/al/proyecto
tail -n 80 storage/logs/laravel.log
php -m | grep -iE 'pdo|sqlite|mysql'
php artisan --version
```

Si el log dice `could not find driver`, instala la extensión correspondiente. Por ejemplo:

```bash
sudo apt install php-sqlite3
```

Si el problema es de permisos de `storage` o `bootstrap/cache`, corrige el propietario. En
la configuración habitual de Valet Linux, nginx se ejecuta con tu propio usuario, así que
no debería hacer falta usar `www-data`.

### La creación se queda esperando

Composer puede tardar varios minutos en una red lenta. El diálogo mantiene el registro en
vivo y no permite cerrarse mientras trabaja. No cierres la aplicación: si lo haces, el
proceso puede quedar a medias y la carpeta incompleta.

Si el proceso se cuelga de forma indefinida, revisa en otra terminal:

```bash
ps aux | grep -E 'composer|php'
```

No hay botón de cancelación en esta versión.

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
- Crea proyectos Laravel nuevos, pero no elimina sitios, enlaces, rutas aparcadas, proxies
  ni túneles.
- No registra carpetas existentes desde la interfaz.
- No cancela una creación de Composer en curso.
- No instala extensiones PHP ni bases de datos para el proyecto creado.
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
- La cancelación detiene el proceso que lanza el panel, pero un comando ya elevado puede
  terminar por su cuenta.

## Comandos de diagnóstico

Estos comandos son de lectura o de validación; no cambian la configuración:

| Para qué | Comando |
|---|---|
| Versión de Valet | `valet --version` |
| Versión de Composer | `composer --version` |
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
