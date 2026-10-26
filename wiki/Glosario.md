# Glosario

Términos que aparecen en la aplicación y en esta wiki.

## A

**Allowlist (lista permitida)**
Lista cerrada de valores aceptados. El panel la usa para servicios, acciones y modos DNS:
todo lo que no está en la lista se rechaza.

**Apache**
Servidor web alternativo. El panel solo gestiona la ruta de Debian/Ubuntu
`/etc/apache2` y puede moverlo de puerto o detenerlo para liberar 80/443.

**AppImage**
Formato de paquete portable de Linux. No se instala; se le da permiso de ejecución y se
abre. Puede necesitar FUSE.

**askpass**
Programa que muestra un diálogo de contraseña. El panel crea
`~/.valet-dashboard/bin/askpass` con `zenity` o `kdialog` para que `sudo` pueda pedir la
contraseña sin terminal.

**`/etc/hosts`**
Archivo local de resolución de nombres. En el modo **Hosts**, el panel inserta un bloque
gestionado con los sitios.

## B

**Backup (copia de seguridad)**
Copia de archivos de configuración antes de modificarlos. Se guarda en
`~/.valet-dashboard/backups/<fecha>/`.

**Bloque gestionado**
Tramo de `/etc/hosts` delimitado por:

```text
# BEGIN VALET DASHBOARD
...
# END VALET DASHBOARD
```

El panel reemplaza ese bloque completo; no duplica entradas.

## C

**Carbon**
Paleta visual del panel, de tonos neutros y acento rojo. Es la paleta por defecto.

**Clásico (modo DNS)**
Modo en el que Valet instala y gestiona su propio DNS. Puede tocar `systemd-resolved`,
`/etc/resolv.conf` y NetworkManager. Es el modo de mayor riesgo.

**Composer**
Gestor de dependencias de PHP. El panel usa un Composer **aislado** para no modificar el
global.

**Composer aislado**
Instalación de Composer con `COMPOSER_HOME=~/.config/valet-dashboard/composer`. Instala
Valet ahí y deja intacto el Composer del usuario.

**Context bridge (`contextBridge`)**
Mecanismo de Electron que expone una API controlada desde el preload al renderer. El panel
expone `window.api`.

**Context isolation**
Aislamiento entre el contexto de la página y el de Electron. Está activado: el renderer no
ve Node ni `ipcRenderer`.

**CSP (Content Security Policy)**
Política que restringe qué recursos puede cargar la interfaz. La del panel solo permite
recursos propios, imágenes `data:` y estilos inline.

## D

**`.deb`**
Formato de paquete de Debian/Ubuntu. Se instala con `apt install ./archivo.deb`.

**DNS seguro (modo Seguro)**
Modo del panel en el que dnsmasq escucha solo en `127.0.0.1:5354` y systemd-resolved recibe
una ruta para el dominio de Valet. No detiene NetworkManager ni reescribe `/etc/resolv.conf`.

**dnsmasq**
Servidor DNS ligero. El panel usa una instancia propia para el modo Seguro; el sistema puede
tener otra.

**Dominio de Valet**
Sufijo que Valet añade a los sitios, por defecto `test`. Se lee de
`~/.valet/config.json` (clave `domain`; también se admite `tld`). No es un TLD real de
Internet.

## E

**Electron**
Marco que empaqueta una aplicación web con Chromium y Node. El panel usa Electron 33.

**Electron builder**
Herramienta que genera los paquetes AppImage, `.deb` y `.rpm`.

**`execFile`**
Función de Node que ejecuta un programa con un array de argumentos, sin pasar por un shell.
El panel la usa para evitar inyección de comandos.

## F

**FPM (PHP-FPM)**
Gestor de procesos de PHP. Cada versión instalada suele tener su servicio
`phpX.Y-fpm`. Si el servicio está caído, el sitio puede devolver 502.

## G

**Gestor de paquetes**
`apt`, `dnf` o `pacman`. El panel detecta el sistema desde `/etc/os-release` y usa el que
corresponda para instalar dependencias.

## H

**Hosts (modo DNS)**
Modo que resuelve los sitios mediante `/etc/hosts`. No usa daemon DNS y no resuelve
subdominios arbitrarios. Requiere **Sincronizar hosts** al añadir o quitar sitios.

**HTTPS**
HTTP cifrado con TLS. En el panel se activa con `valet secure <sitio>`, que crea un
certificado en `~/.valet/Certificates/`.

## I

**IPC (Inter-Process Communication)**
Comunicación entre el renderer y el proceso principal. El panel usa canales fijos como
`sites:list` o `install:start`.

**`install:event`**
Canal de eventos del proceso principal al renderer. Envía el plan de pasos, el estado de
cada paso y el registro en vivo.

## L

**Linked (enlazado)**
Sitio registrado con `valet link`. Apunta a un directorio concreto y tiene prioridad sobre
un sitio *parked* con el mismo nombre.

**`localStorage`**
Almacenamiento del navegador interno. El panel guarda ahí los ajustes visuales y el ancho
del panel lateral.

## M

**Min**
Paleta visual del panel de tonos neutros y acento azul.

**Modo Clásico**
Consulta **Clásico (modo DNS)**.

**Modo Hosts**
Consulta **Hosts (modo DNS)**.

**Modo Seguro**
Consulta **DNS seguro (modo Seguro)**.

## N

**NetworkManager**
Gestor de conexiones de red habitual en escritorios Linux. El modo Seguro no lo detiene ni
lo reinstala.

**nginx**
Servidor web que usa Valet para servir los sitios. El panel detecta y cambia sus puertos.

## P

**Parked (aparcado)**
Sitio que es un subdirectorio de una carpeta registrada con `valet park`.

**`pkexec`**
Herramienta de polkit que ejecuta un comando como otro usuario, normalmente root, mostrando
un diálogo de autenticación. El panel la usa para paquetes, servicios, DNS y archivos de
`/etc`.

**Polkit**
Sistema de autorización de Linux. Proporciona el diálogo gráfico que ves cuando el panel
pide permisos de administrador.

**Puerto reservado**
Puerto que el panel no permite usar para nginx o Apache: `53` (DNS), `67` y `68` (DHCP),
`123` (NTP), `5353` (mDNS) y `5354` (DNS seguro del panel).

## R

**Render (renderer)**
Proceso de Electron que dibuja la interfaz React. Está en sandbox y no tiene acceso a Node.

**`resolv.conf`**
Archivo que indica los servidores DNS. En sistemas con systemd-resolved suele ser un enlace
al stub `127.0.0.53`.

**Rollback (reversión)**
Restauración automática de los archivos originales cuando falla una validación o una
recarga. El panel lo hace al cambiar puertos.

**`rpm`**
Formato de paquete de Fedora, RHEL y derivados. Se instala con `dnf install ./archivo.rpm`.

## S

**Sandbox**
Aislamiento del renderer. Está activado en la ventana del panel.

**Secure**
Estado de un sitio con certificado HTTPS. Se activa con `valet secure` y se quita con
`valet unsecure`.

**Servicio (unidad de systemd)**
Proceso gestionado por `systemctl`, por ejemplo `nginx.service` o `php8.3-fpm.service`. El
panel muestra una lista permitida.

**`shell.openExternal`**
Función de Electron que abre una URL en el navegador predeterminado. El panel la usa solo
en el botón **Abrir**, con una URL calculada en el proceso principal.

**Stub resolver**
Escucha de systemd-resolved en `127.0.0.53`. El modo Seguro espera que `/etc/resolv.conf`
apunte ahí.

**`sudo` auxiliar**
Envoltorio que crea el panel para que Valet use `sudo` con `SUDO_ASKPASS` sin abrir una
terminal. No ejecuta Valet como root.

**`SUDO_ASKPASS`**
Variable que indica a `sudo` qué programa debe pedir la contraseña.

**`systemctl`**
Herramienta para consultar y controlar servicios de systemd.

**systemd**
Sistema de inicio y gestión de servicios de Linux. El panel depende de él.

**systemd-resolved**
Servicio de resolución DNS de systemd. El modo Seguro le añade una ruta para el dominio de
Valet.

## T

**TLD**
En el código, sufijo del dominio de Valet (`test`). En sentido estricto, un TLD es un dominio
de primer nivel; aquí se usa como el sufijo de los sitios.

**Typecheck**
Comprobación de tipos con `tsc --noEmit`. En el proyecto se ejecuta con
`npm run typecheck`.

## U

**URL del sitio**
Dirección que calcula el panel con el esquema (`http` o `https`), el nombre, el dominio y el
puerto real de nginx. El botón **Abrir** la usa.

## V

**Valet**
Herramienta de desarrollo PHP que configura nginx, PHP-FPM y DNS para servir sitios locales.
El panel instala y gestiona por defecto la variante `cpriego/valet-linux`.

**Valet aislado**
Valet instalado en el Composer propio del panel. Es el único que el panel puede desinstalar
automáticamente.

**Valet externo**
Valet detectado fuera del Composer del panel. El panel lo muestra, pero no lo desinstala.

**VirtualHost**
Bloque de configuración de Apache que define un sitio y sus puertos. El panel reescribe los
puertos de las etiquetas `<VirtualHost ...:puerto>`.

## W

**`window.api`**
API tipada que el preload expone al renderer. Es la única vía de la interfaz para hablar con
el proceso principal.

## X

**X11 / Wayland**
Servidores gráficos de Linux. El panel funciona en ambos; los diálogos de polkit y
`zenity`/`kdialog` dependen del escritorio.

## Relacionado

- [Interfaz](Interfaz)
- [Arquitectura](Arquitectura)
- [Seguridad y copias](Seguridad-y-copias)
- [Solución de problemas](Solucion-de-problemas)
