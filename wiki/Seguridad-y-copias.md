# Seguridad y copias

El panel ejecuta comandos privilegiados para instalar paquetes, cambiar puertos, gestionar
servicios y configurar DNS. Esta página explica qué permisos usa, cómo protege la interfaz
y qué copias guarda antes de tocar el sistema.

## Modelo de seguridad

La aplicación sigue el modelo de Electron con tres procesos:

| Proceso | Qué puede hacer | Qué no puede hacer |
|---|---|---|
| **Renderer** (React) | Dibujar la interfaz, leer `window.api`, guardar ajustes en `localStorage` | Acceder a Node, al sistema de archivos o a `child_process` |
| **Preload** | Exponer una API fija con `contextBridge` | Exponer `ipcRenderer` completo ni módulos de Node |
| **Main** (Node) | Ejecutar comandos, leer y escribir archivos, abrir el navegador | Cargar contenido remoto en la ventana (el código no lo hace) |

La ventana se crea con:

```ts
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
}
```

Además:

- La interfaz se carga desde archivos locales (`out/renderer/index.html`) o desde el
  servidor de desarrollo; no se navega a webs externas.
- Hay una **Content Security Policy** que solo permite recursos propios, imágenes `data:`
  y estilos inline.
- El menú de la aplicación se elimina al arrancar.
- El renderer solo puede llamar a los canales IPC declarados en la API. No hay un canal
  genérico del tipo «ejecuta esto».
- El botón **Abrir** no recibe una URL del renderer: el proceso principal calcula la URL a
  partir del nombre del sitio y llama a `shell.openExternal`. El renderer solo envía el
  nombre.

## Ejecución de comandos

### Sin shell

Los comandos se ejecutan con `execFile` y un array de argumentos:

```ts
execFile(cmd, args, { env, timeout: 600_000 }, ...)
```

No se usa `exec`, `spawn` con `shell: true` ni interpolación de cadenas en una línea de
comandos. El instalador usa `spawn` con `cmd` y `args` separados, también sin shell.

Esto evita inyección de comandos por nombres de sitios, proyectos, versiones, puertos,
rutas o paquetes. Aun así, el proceso principal valida los datos antes de usarlos.

### Validaciones en el proceso principal

| Dato | Validación |
|---|---|
| Nombre de sitio | No vacío, sin espacios al inicio/fin, distinto de `.` y `..`, sin `/`, `\`, caracteres de control ni guion inicial |
| Puerto | Entero entre 1 y 65535 |
| Puerto web | Además, no puede ser 53, 67, 68, 123, 5353 ni 5354 |
| Acción de servicio | Solo `start`, `stop` o `restart` |
| Servicio | Debe estar en la lista permitida y existir en `systemctl` |
| Versión de PHP | Solo el formato `X.Y` |
| Paquete de Composer | Solo `vendor/nombre` con caracteres seguros; se pasa a minúsculas |
| Modo DNS | Solo `safe`, `hosts` o `classic` |
| Carpeta de proyectos | Debe ser absoluta después de expandir `~` |
| Nombre de proyecto | Minúsculas, números y guiones; 1–63 caracteres; sin guion inicial ni final |
| Versión de Laravel | Restricción acotada a caracteres de Composer; se rechaza si empieza por `-` |
| Carpeta de destino | Debe existir, ser un directorio, tener permiso de escritura y resolverse a una ruta real |
| TLD del DNS | Letras, números, puntos y guiones, con inicio y fin alfanumérico |

### Privilegios

| Operación | Mecanismo | ¿Pide contraseña? |
|---|---|---|
| Instalar paquetes (`apt`, `dnf`, `pacman`) | `pkexec` | Sí |
| Iniciar, detener o reiniciar servicios | `pkexec systemctl` | Sí |
| Validar nginx o Apache | `pkexec nginx -t`, `pkexec apache2ctl configtest` | Sí |
| Escribir archivos de `/etc` | `pkexec tee`, con el contenido por la entrada estándar | Sí |
| Aplicar DNS seguro u hosts | `pkexec /usr/local/libexec/valet-dashboard/dns-helper.sh` | Sí |
| Copia de seguridad del sistema | `pkexec /usr/local/libexec/valet-dashboard/backup.sh` | Sí |
| `valet install`, `valet secure`, `valet use` | `valet` como tu usuario | Valet eleva lo necesario con `sudo` |
| `valet link` al crear un proyecto | `valet` como tu usuario | Normalmente no; el enlace se crea en `~/.valet/Sites` |

El panel **no ejecuta Valet como root**. Valet se lanza con tu usuario y usa un `sudo`
auxiliar con `SUDO_ASKPASS` para las pocas órdenes que necesitan elevación. Así se conserva
el modelo de permisos de Valet.

### Ayudante de contraseña

En `~/.valet-dashboard/bin/` se crean dos scripts que se ejecutan **como tu usuario**:

- `askpass`: muestra un diálogo con `zenity` o, si no está, `kdialog`.
- `sudo`: envuelve las llamadas de Valet que usan `sudo env ...` y propaga la variable
  `VALET_DASHBOARD_SAFE_DNS`.

La contraseña **no se guarda**: se pide en cada operación que la necesite y se pasa a `sudo`
mediante `SUDO_ASKPASS`.

### Ayudantes de root

`dns-helper.sh` y `backup.sh` se ejecutan **como root**, así que viven fuera de tu carpeta:
`/usr/local/libexec/valet-dashboard/`, con dueño `root`, permisos `0755` y sin escritura para
el resto. Si estuvieran en tu `home`, cualquiera podría cambiarlos entre el diálogo de polkit y
la ejecución y obtener root.

Los dos empiezan comprobando que son root y que el destino de la copia cuelga de
`~/.valet-dashboard/backups`, con el camino ya resuelto con `readlink -f`. Así un enlace
simbólico en tu `home` no puede hacer que root escriba en `/etc` ni que ceda la propiedad de
archivos del sistema. Las copias se crean con `0700` y `chown -R -h`, que no sigue enlaces.

Si no hay `zenity` ni `kdialog`, el ayudante termina con error. Si no hay agente polkit, el
diálogo de `pkexec` no aparece y la operación falla.

### Protección del DNS de Valet

En los modos **Seguro** y **Hosts**, el instalador parchea el archivo
`cli/Valet/DnsMasq.php` del paquete de Valet para que sus métodos `install()` y
`uninstall()` no cambien el DNS cuando existe:

```text
VALET_DASHBOARD_SAFE_DNS=1
```

- El parche se aplica antes de ejecutar `valet install` y antes de `valet uninstall`.
- Se comprueba con `php -l`; si deja el archivo inválido, se restaura el original y se
  cancela la operación antes de tocar la red.
- Si no se encuentran los métodos esperados, el instalador aborta: no sigue con una
  versión de Valet que no puede proteger.
- En modo **Clásico** no se aplica el parche, porque se quiere el DNS de Valet.

> Por eso no debes ejecutar `valet install` ni `valet uninstall` desde una terminal después
> de usar el panel: esas órdenes no llevan la variable de protección y pueden volver a
> aplicar el DNS clásico.

## Copias de seguridad

Todas las copias van a:

```text
~/.valet-dashboard/backups/<fecha>/<tipo>/
```

La fecha tiene formato ISO con `:` y `.` sustituidos por `-`, por ejemplo
`2026-10-26T18-30-00-000Z`.

| Tipo | Cuándo se crea | Contenido |
|---|---|---|
| `system` | Antes de instalar o reparar | Configuración completa del sistema |
| `dns` | Antes de aplicar DNS seguro u hosts | Configuración de red y DNS |
| `dns-remove` | Antes de retirar el DNS del panel | Configuración de red y DNS |
| `nginx` | Al guardar puertos de nginx | Solo los archivos modificados |
| `apache` | Al guardar puertos de Apache | Solo los archivos modificados |
| `env` | Al configurar el `.env` de Laravel desde **Correo** | Copia del `.env` del sitio |
| `php` | Al cambiar `sendmail_path` desde **Correo** | Copia de `fpm/php.ini` y `cli/php.ini` |

### Copia `system`

La crea `backup.sh` con `pkexec` antes de actualizar paquetes o ejecutar `valet install`.
Copia, si existen:

```text
/etc/nginx
/etc/php
/etc/apache2
/etc/dnsmasq.conf
/etc/dnsmasq.d
/etc/default/dnsmasq
/etc/resolv.conf
/etc/NetworkManager/NetworkManager.conf
/etc/NetworkManager/conf.d
/etc/systemd/resolved.conf
/etc/systemd/resolved.conf.d
/etc/hosts
/etc/valet-dashboard
/usr/local/bin/valet
```

La copia conserva permisos y propietario originales (`cp -a`) y luego se cambia el
propietario del destino a tu usuario para que puedas leerla.

### Copia `dns`

La crea `dns-helper.sh` antes de aplicar un modo DNS. Copia los mismos archivos de red,
DNS, hosts y el servicio `valet-dashboard-dns.service`, con un sufijo numérico para evitar
colisiones:

```text
resolv.conf.<nanosegundos>
resolved.conf.d.<nanosegundos>
hosts.<nanosegundos>
...
```

El modo **Seguro** solo continúa si:

- `dnsmasq --test` acepta la configuración.
- El servicio `valet-dashboard-dns` arranca.
- `systemd-resolved` se reinicia correctamente.
- `valet-dashboard.<dominio>` resuelve a `127.0.0.1`.
- Si antes resolvía Internet, `example.com` sigue resolviendo.

Si algo falla, el script retira su configuración y reinicia `systemd-resolved`. El panel
también verifica la resolución después y muestra el error.

### Copias de puertos

Antes de modificar un archivo de nginx o Apache, el panel copia **solo ese archivo** en
`backups/<fecha>/nginx` o `backups/<fecha>/apache`, con un nombre único:

```text
<milisegundos>-<aleatorio>-<nombre-original>
```

Si `nginx -t` o `apache2ctl configtest` falla, o si la recarga falla, el panel restaura
esos archivos y vuelve a cargar la configuración anterior cuando el servicio estaba
activo.

### Qué no se copia

- Tus proyectos y sus archivos.
- Bases de datos MySQL, MariaDB, PostgreSQL o Redis.
- Contenido de `/home` (incluidos `~/.valet` y tus proyectos).
- Certificados y claves que no estén dentro de las rutas copiadas.
- Configuración de cortafuegos.
- Registros del sistema.
- Los ajustes visuales del panel (están en el almacenamiento de Electron).
- El buzón de Mailpit (`~/.valet-dashboard/mailpit/mailpit.db`) no se copia con las copias
  de sistema; usa **Vaciar buzón** desde [Correo](Correo) cuando no lo necesites.
- La configuración de Mailpit (`~/.config/valet-dashboard/mailpit.json`, auth, TLS y YAML)
  tampoco se copia automáticamente; si quieres conservarla, cópiala a mano.

### Conservación y restauración

- **No hay limpieza automática**: las copias se acumulan hasta que las borres a mano.
- **No hay botón para restaurar** desde la interfaz.
- La restauración automática solo cubre los archivos de puertos y los cambios DNS del
  propio panel.
- Para restaurar a mano, localiza la carpeta, detén el servicio afectado, copia el archivo
  con `sudo`, valida la configuración y vuelve a iniciar el servicio. Hazlo solo si sabes
  qué archivo corresponde a cada ruta.
- Las copias pueden contener información sensible (nombres de red, configuración de
  servidores, rutas, certificados). Protégelas:

  ```bash
  chmod -R 700 ~/.valet-dashboard/backups
  ```

## Datos que guarda el panel

| Ruta | Contenido |
|---|---|
| `~/.valet-dashboard/config.json` | Puertos HTTP/HTTPS de nginx y Apache guardados por el panel |
| `~/.valet-dashboard/backups/` | Copias descritas arriba |
| `~/.valet-dashboard/bin/` | `askpass`, `sudo`, `mailpit` y `mailpit.prev` |
| `/usr/local/libexec/valet-dashboard/` | `dns-helper.sh` y `backup.sh`, propiedad de `root` |
| `~/.valet-dashboard/mailpit/` | Buzón SQLite de Mailpit |
| `~/.config/valet-dashboard/mailpit.json` | Configuración de Mailpit (incluye token de GitHub y credenciales de auth) |
| `~/.config/valet-dashboard/mailpit.env` | Variables `MP_*` leídas por systemd |
| `~/.config/valet-dashboard/mailpit/` | Archivos de contraseñas, TLS y YAML (`0600`/`0644`) |
| `~/.config/systemd/user/valet-dashboard-mailpit.service` | Servicio de usuario de Mailpit |
| `~/.valet-dashboard/hosts-generated` | Borrador del bloque de `/etc/hosts` para el modo Hosts |
| `~/.config/valet-dashboard/composer/` | Composer aislado y paquete de Valet |
| `~/.config/Valet Dashboard/` | Datos de Electron: ajustes, almacenamiento local y caché (ruta habitual) |
| `~/.valet/config.json` | Dominio y rutas de Valet |
| `~/.valet/Sites/` | Enlaces de `valet link` |
| `~/.valet/Certificates/` | Certificados de sitios con HTTPS |
| `~/.valet/Nginx/` | Configuración de nginx de Valet |
| `/etc/valet-dashboard/` | Configuración de dnsmasq del modo Seguro |
| `/etc/systemd/system/valet-dashboard-dns.service` | Servicio DNS del panel |
| `/etc/systemd/resolved.conf.d/valet-dashboard.conf` | Ruta DNS `~<dominio>` en systemd-resolved |
| `/etc/hosts` | Bloque gestionado `# BEGIN/END VALET DASHBOARD` en modo Hosts |
| `/usr/local/bin/valet` | Lanzador de Valet |

## Privacidad y red

- No hay cuentas, telemetría, analítica ni publicidad.
- No hay actualización automática ni comprobación de versión.
- La aplicación no abre conexiones por sí sola, salvo:
  - El gestor de paquetes al instalar dependencias.
  - Composer al descargar Valet y sus dependencias.
  - GitHub al consultar o descargar releases de Mailpit.
  - El navegador cuando pulsas **Abrir**.
- Los registros de instalación se muestran en memoria y se limitan a los últimos 60 000
  caracteres. No se escriben en disco.
- Las copias y la configuración se quedan en tu equipo.
- El panel no envía rutas, nombres de sitios ni datos del sistema a ningún servidor.

## Riesgos que debes conocer

| Riesgo | Detalle | Mitigación |
|---|---|---|
| **Modo DNS Clásico** | Valet puede detener `systemd-resolved`, reescribir `/etc/resolv.conf` y tocar NetworkManager; puede cortar WiFi/DNS | Usa **Seguro** o **Hosts**; el modo Clásico pide confirmación |
| **Paquete de Composer** | El panel instala el paquete `vendor/nombre` que escribas y ejecuta sus scripts y `valet install` | Usa solo paquetes de confianza, por defecto `cpriego/valet-linux` |
| **Reemplazo de Valet** | Si hay un Valet externo, el instalador crea el aislado y puede reemplazar `/usr/local/bin/valet` | Lee la advertencia y confirma solo si lo deseas |
| **Permisos root** | `pkexec` ejecuta comandos concretos como root | Revisa el comando que muestra polkit y cancela si no lo esperas |
| **Copias sensibles** | Pueden contener configuración de red y rutas | Restringe permisos y bórralas cuando ya no las necesites |
| **Servicios detenidos** | Detener nginx, PHP-FPM, DNS o una base de datos afecta a los sitios y aplicaciones | Comprueba el estado antes de detener |
| **Certificados** | `valet secure` crea certificados que el navegador puede no confiar | Es normal ver una advertencia; no desactives la verificación TLS |
| **Buzón de Mailpit** | Puede contener correo real con tokens, enlaces mágicos y datos personales | Mantenlo en `127.0.0.1`, vacíalo a menudo y bórralo al desinstalar |
| **Credenciales de Mailpit** | `mailpit.json` guarda el token de GitHub y las contraseñas de auth | El archivo se escribe con permisos `0600`; no lo compartas |

## Avisos de `npm audit`

`npm audit --omit=dev` no encuentra vulnerabilidades: la aplicación no tiene dependencias de
ejecución; todo lo que declara `package.json` es de desarrollo.

El `npm audit` completo informa de avisos en la cadena de herramientas (`tinypool`, que usa
Vitest, y `node-gyp`, `cacache` y `tar`, que usa electron-builder). Resolverlos pide Vitest 5, que
a su vez exige Vite 6, y el panel compila con Vite 5. Se aceptan con este razonamiento:

- solo se ejecutan al compilar o al probar, nunca en la aplicación distribuida;
- sus opciones no las controla nadie de fuera: salen de este repositorio.

Cuando la cadena de compilación suba a Vite 6, actualiza Vitest y vuelve a ejecutar `npm audit`.

## Desinstalación y datos

**Desinstalar** en el panel:

1. Aplica la protección DNS y ejecuta `valet uninstall` si el Valet es el aislado.
2. Elimina el DNS del panel (servicio, configuración de resolved y bloque de hosts).
3. Quita el paquete del Composer aislado.

No elimina:

- Tus proyectos.
- `~/.valet-dashboard/backups/`.
- `~/.valet-dashboard/config.json`.
- Los ajustes visuales de Electron.
- Un Valet externo detectado.
- Los restos de un DNS clásico instalado antes.

Mailpit se desinstala desde **Correo → Integraciones → Desinstalar Mailpit**. Esa acción
detiene y elimina la unidad y el binario gestionado, pero conserva la configuración y el
buzón salvo que marques **Borrar también los correos almacenados**.

El panel no borra por separado `/usr/local/bin/valet`; lo que haga `valet uninstall` con ese
archivo queda fuera del control del dashboard. Si usaste el modo Clásico, revisa los restos
habituales:

```text
/etc/dnsmasq.d/valet
/opt/valet-linux
/etc/NetworkManager/conf.d/valet.conf
```

## Buenas prácticas

1. Usa el modo **Seguro** o **Hosts**; evita **Clásico** salvo diagnóstico.
2. No ejecutes la aplicación como root.
3. No ejecutes `valet install` ni `valet uninstall` desde la terminal después de usar el
   panel.
4. Revisa el comando que muestra el diálogo de polkit antes de autenticarte.
5. Mantén las copias en una ruta privada y bórralas cuando ya no sean necesarias.
6. Antes de cambiar puertos, comprueba qué proceso los ocupa.
7. No detengas `valet-dashboard-dns` si usas el modo Seguro.
8. Si algo falla, usa **Reparar instalación** antes de editar archivos a mano.
9. Activa autenticación y TLS en Mailpit si lo expones fuera de `127.0.0.1`; en desarrollo
   local, mantén el valor por defecto.

## Relacionado

- [Instalación](Instalacion)
- [Puertos](Puertos)
- [Servicios](Servicios)
- [Correo](Correo)
- [Solución de problemas](Solucion-de-problemas)
- [Arquitectura](Arquitectura)
