# Instalación

Hay dos instalaciones distintas:

1. **El panel** (Valet Dashboard), que se instala como paquete de Linux.
2. **Valet Linux y sus dependencias**, que el propio panel instala desde la pestaña
   **Instalación**.

El panel puede abrirse en un sistema vacío: no necesita Valet, nginx, PHP ni Composer
para arrancar. La pestaña **Sitios** aparecerá vacía hasta que se instale y registre
algún proyecto.

## Requisitos del panel

- Linux con `systemd`.
- Una forma de pedir la contraseña de administrador: polkit (`pkexec`) con su
  agente gráfico, o `sudo` con `zenity`/`kdialog`. Si falta polkit, el panel usa
  `sudo -A` y avisa en la guía de requisitos.
- NetworkManager es lo habitual y recomendable, sobre todo para el diagnóstico de red.
- `sudo` disponible en `/usr/bin/sudo`: el ayudante de Valet lo utiliza para elevar
  permisos cuando Valet lo necesita.
- Conexión a Internet para descargar paquetes y el paquete de Composer.
- Node.js 20 o superior **solo** si vas a desarrollar o empaquetar la aplicación.

## Instalar el panel

El paquete se genera desde el repositorio:

```bash
npm install
npm run dist
```

El resultado queda en `dist/`:

- **AppImage**: portable; dale permiso de ejecución y ábrelo.
- **.deb**: para Debian, Ubuntu y derivados.
- **.rpm**: para Fedora, RHEL, CentOS y derivados.

Ejemplos:

```bash
chmod +x dist/Valet\ Dashboard-0.1.0.AppImage
./dist/Valet\ Dashboard-0.1.0.AppImage
```

```bash
sudo apt install ./dist/valet-dashboard_0.1.0_amd64.deb
```

```bash
sudo dnf install ./dist/valet-dashboard-0.1.0.x86_64.rpm
```

El panel no tiene actualización automática. Para actualizarlo, instala el paquete nuevo.

## Primer arranque

Al abrir la aplicación:

- **Sitios** consulta `~/.valet/config.json` y `~/.valet/Sites`. Si no existen, muestra
  un estado vacío sin errores.
- **PHP** intenta detectar versiones de PHP-FPM y la versión actual de PHP.
- **Puertos** y **Servicios** se cargan cuando entras en esas secciones.
- **Instalación** ejecuta un diagnóstico completo del sistema.

La ventana mide 1100 × 720 por defecto y tiene un tamaño mínimo de 760 × 520.

## Diagnóstico de la pestaña Instalación

El diagnóstico (`checkEnv`) revisa:

- Distribución y gestor de paquetes compatible: `apt`, `dnf` o `pacman`.
- Herramientas: PHP, Composer, Valet, nginx, dnsmasq, `nmcli`, `certutil`, `xsel`,
  `pkexec`, `sudo` y `zenity`. La página muestra todas menos `sudo` y `zenity`; esas dos
  solo se comprueban en el diagnóstico.
- Puertos 80 y 443 y los procesos que los ocupan.
- Estado de `systemd-resolved`, NetworkManager, `/etc/resolv.conf` y el puerto DNS 5354.
- Resolución de `valet-dashboard.<dominio>`.
- Conflictos con el Composer global (paquetes antiguos de Valet o Illuminate 13).
- Valet aislado, Valet externo y versión detectada.

Cada herramienta aparece como **instalado** o **falta**. Las advertencias se muestran
en la página y en el panel lateral. El botón **Actualizar** vuelve a ejecutar el diagnóstico.

## Opciones de instalación

| Opción | Valor por defecto | Descripción |
|---|---|---|
| **Paquete de Valet** | `cpriego/valet-linux` | Paquete de Composer. Debe tener el formato `vendor/nombre` |
| **Carpeta de proyectos** | `~/Sites` | Se crea si no existe. Debe ser una ruta absoluta o empezar por `~/` |
| **Detener y deshabilitar Apache** | Activado | Si Apache ocupa 80/443, se detiene y se deshabilita |
| **Modo DNS** | El recomendado | **Seguro**, **Hosts** o **Clásico** |

El panel elige automáticamente el modo recomendado la primera vez que carga el
diagnóstico: **Seguro** si `systemd-resolved` está activo, el puerto 5354 está libre,
`/etc/resolv.conf` apunta al stub y dnsmasq está disponible (o se puede instalar con
apt); en caso contrario, **Hosts**.

### Cuándo se deshabilita el botón de instalar

El botón **Instalar Valet** / **Reparar instalación** se deshabilita si:

- Hay una operación en curso.
- Algún requisito previo bloqueante sigue sin resolver.
- Los puertos 80/443 están ocupados por un proceso que no es Apache, o por Apache sin
  haber marcado la opción de detenerlo.
- El modo **Seguro** está seleccionado pero no está disponible.

El motivo se muestra siempre debajo del botón. Ya **no** depende de que exista un gestor
de paquetes compatible: si las herramientas están puestas a mano, el botón cambia a
**Continuar con lo instalado**.

## Requisitos previos y guía manual

La pestaña **Instalación** abre con el panel **Requisitos previos**. Revisa lo que el
panel no puede resolver por sí mismo y, si algo falta, muestra el comando exacto para
arreglarlo, con un botón **Copiar**.

| Requisito | Cuándo bloquea | Cómo se resuelve |
|---|---|---|
| `systemd` | Siempre que falte | Arranca una sesión con systemd; el panel no puede gestionar servicios sin él |
| Elevación de permisos | Sin `pkexec` y sin `sudo`+diálogo | Instala `policykit-1` (Debian/Ubuntu) o `polkit` (Fedora/Arch), o `sudo` con `zenity` |
| `sudo` | Siempre que falte | Instala el paquete `sudo` |
| Diálogo de contraseña | Sin `zenity` ni `kdialog` | Instala `zenity` o `kdialog` |
| Paquetes del sistema | Solo si no hay gestor compatible | Instálalos a mano y pulsa **Volver a comprobar** |
| Red | Nunca: solo avisa | Revisa la conexión y el DNS |
| Espacio en disco | Por debajo de 500 MB | Libera espacio y reintenta |

Comandos por distribución:

```bash
# Debian, Ubuntu y derivados
sudo apt-get update
sudo apt-get install -y policykit-1 sudo zenity curl git unzip jq xsel \
  libnss3-tools dnsmasq-base nginx composer php-cli php-fpm php-curl \
  php-mbstring php-xml php-zip php-mysql php-sqlite3
```

```bash
# Fedora, RHEL y derivados
sudo dnf install -y polkit sudo zenity curl git unzip jq xsel nss-tools dnsmasq \
  nginx composer php-cli php-fpm php-mbstring php-xml php-mysqlnd php-process php-pdo
```

```bash
# Arch y derivados
sudo pacman -S --needed polkit sudo zenity curl git unzip jq xsel nss dnsmasq \
  nginx composer php
```

Después de instalarlos, pulsa **Volver a comprobar**. Cuando el panel puede resolverlo
solo, el requisito no bloquea: aparece como aviso y el instalador lo hace en el paso
**Instalar dependencias del sistema**.

### Distribución no soportada

Si `/etc/os-release` no es Debian/Ubuntu, Fedora/RHEL/CentOS ni Arch, el panel no
instala paquetes. Si ya tienes PHP, Composer, nginx y las utilidades puestas a mano:

- El paso de paquetes se **omite**.
- El botón cambia a **Continuar con lo instalado** y el resto del flujo (Composer
  aislado, protección DNS, `valet install`, `valet park`) funciona igual.
- Necesitarás el modo **Hosts** si tu sistema no tiene `systemd-resolved`.

## Flujo de instalación

El instalador ejecuta pasos idempotentes y muestra el progreso y un registro en vivo.
Cada paso puede terminar como **ok**, **skip** o **fail**.

| # | Paso | Qué hace |
|---|---|---|
| 1 | Comprobar requisitos, puertos y DNS | Preflight: valida requisitos previos, puertos, DNS y el modo elegido |
| 2 | Crear copia de seguridad | Copia la configuración del sistema en `~/.valet-dashboard/backups/<fecha>/system` |
| 3 | Liberar los puertos 80/443 (Apache) | Detiene y deshabilita `apache2` si está ocupando esos puertos y la opción está marcada |
| 4 | Instalar dependencias del sistema | Consulta qué falta; si no falta nada, **omite** el paso. Si falta algo, actualiza índices e instala solo lo ausente |
| 5 | Preparar ayudante de contraseña | Crea `askpass`, el envoltorio de `sudo` y los scripts de DNS/backup |
| 6 | Instalar Valet con Composer aislado | Usa `~/.config/valet-dashboard/composer`; no toca el Composer global |
| 7 | Aplicar protección DNS a Valet | Parchea Valet para que no aplique su DNS clásico (excepto en modo Clásico) |
| 8 | Retirar el DNS seguro anterior | Solo en modo Clásico: elimina la configuración DNS del panel |
| 9 | Configurar nginx y PHP-FPM | Ejecuta `valet install` como tu usuario y valida la configuración con `nginx -t` |
| 10 | Registrar carpeta de proyectos | Crea la carpeta y ejecuta `valet park` dentro de ella |
| 11 | Configurar DNS de los sitios | Aplica el modo Seguro, Hosts o Clásico |
| 12 | Verificar instalación | Comprueba Valet, `/usr/local/bin/valet`, nginx, PHP-FPM, la resolución y que la versión de PHP coincida con un FPM instalado |
| 13 | Probar un sitio de extremo a extremo | Crea un sitio temporal, pide su `index.php` por HTTP y lo borra. Distingue 502 (PHP-FPM), 404 (nginx) y 000 (nginx caído) |

> El paso de Composer se omite si ya existe
> `~/.config/valet-dashboard/composer/vendor/bin/valet`. Para cambiar de paquete,
> desinstala primero el Valet aislado.
>
> La prueba de humo no usa DNS: envía `Host: valet-dashboard-health.<dominio>` contra
> `127.0.0.1`, así funciona igual en modo Seguro y Hosts. Si ya existe esa carpeta en tu
> carpeta de proyectos, el paso se omite y queda anotado en el registro.

### Dependencias que instala

**Debian/Ubuntu (`apt`)**

- Base: `curl`, `git`, `unzip`, `jq`, `xsel`, `zenity`, `libnss3-tools`, `dnsmasq-base`,
  `nginx`, `composer`.
- PHP: si detecta una versión instalada, instala `phpX.Y-cli`, `phpX.Y-fpm`,
  `phpX.Y-curl`, `phpX.Y-mbstring`, `phpX.Y-xml`, `phpX.Y-zip`, `phpX.Y-mysql` y
  `phpX.Y-sqlite3`. Si no, instala los paquetes `php-*` equivalentes.

> `php-sqlite3` no es opcional en la práctica: Laravel 11 y posteriores usan SQLite
> como base de datos por defecto, y `artisan migrate` falla sin el controlador.

**Fedora/RHEL/CentOS (`dnf`)**

`curl`, `git`, `unzip`, `jq`, `xsel`, `zenity`, `nss-tools`, `dnsmasq`, `nginx`,
`composer`, `php-cli`, `php-fpm`, `php-mbstring`, `php-xml`, `php-mysqlnd`,
`php-process` y `php-pdo`.

> `php-process` aporta `ext-posix`, que Valet declara como obligatoria; `php-pdo`
> incluye el controlador de SQLite.

**Arch (`pacman`)**

`curl`, `git`, `unzip`, `jq`, `xsel`, `zenity`, `nss`, `dnsmasq`, `nginx`, `composer`,
`php`.

> El instalador **no** instala servidores MySQL/MariaDB, PostgreSQL, Redis ni Apache.
> Tampoco instala versiones adicionales de PHP.

### Contraseñas y permisos

- Las operaciones de sistema usan `pkexec`; aparecerá el diálogo de polkit del escritorio.
- Si no hay `pkexec`, se usa `/usr/bin/sudo -A` con el mismo diálogo. El panel lo indica
  en el registro: `Elevación: sudo con ventana de contraseña`.
- Valet se ejecuta como tu usuario y usa un `sudo` auxiliar con `SUDO_ASKPASS`.
- El diálogo de contraseña usa `zenity` y, si no está, `kdialog`.
- Si no hay ninguna forma de elevar, la instalación no empieza: el panel muestra los
  comandos para instalar polkit o `sudo` con diálogo.

## Modos DNS

| Modo | Cómo resuelve `*.test` | Riesgo | Cuándo usarlo |
|---|---|---|---|
| **Seguro** | dnsmasq propio en `127.0.0.1:5354` y una ruta en systemd-resolved | Bajo | Recomendado en escritorios con systemd-resolved |
| **Hosts** | Entradas en `/etc/hosts` para los sitios conocidos | Bajo | Si no hay systemd-resolved o el puerto 5354 está ocupado |
| **Clásico** | DNS de Valet | Alto | Solo diagnóstico avanzado |

### Modo Seguro

- Requiere `systemd-resolved` activo, `/etc/resolv.conf` apuntando al stub
  (`127.0.0.53`) y el puerto 5354 libre.
- Crea:
  - `/etc/valet-dashboard/dnsmasq.conf`
  - `/etc/systemd/system/valet-dashboard-dns.service`
  - `/etc/systemd/resolved.conf.d/valet-dashboard.conf`
- dnsmasq escucha solo en `127.0.0.1:5354` y responde `address=/<dominio>/127.0.0.1`.
- No detiene NetworkManager, no reescribe `/etc/resolv.conf` y no desactiva
  systemd-resolved.
- Antes de aplicar cambios guarda una copia de la configuración de red.
- Si falla la resolución de `valet-dashboard.<dominio>` o se deja de resolver Internet,
  retira su configuración y reinicia systemd-resolved.

### Modo Hosts

- No usa daemon DNS.
- Añade un bloque gestionado a `/etc/hosts`:

  ```text
  # BEGIN VALET DASHBOARD
  127.0.0.1 valet-dashboard.test
  127.0.0.1 mi-proyecto.test
  # END VALET DASHBOARD
  ```

- Incluye `valet-dashboard` y los sitios actuales con nombres válidos.
- **No resuelve subdominios arbitrarios**: solo los nombres exactos que están en el bloque.
- Cuando añadas o quites sitios, pulsa **Sincronizar hosts** en la pestaña Instalación.
- El bloque anterior se reemplaza; no se duplica.

### Modo Clásico

- Deja que Valet instale y gestione su propio DNS.
- Puede detener o tocar `systemd-resolved`, reescribir `/etc/resolv.conf` y modificar
  NetworkManager. Puede cortar el WiFi o el DNS.
- El panel pide confirmación antes de usarlo.
- No se recomienda para uso diario.
- Si hay restos de un DNS clásico anterior, el diagnóstico avisa; el instalador no los
  elimina automáticamente.

## Botones de la pestaña Instalación

| Botón | Cuándo está disponible | Qué hace |
|---|---|---|
| **Instalar Valet** / **Reparar instalación** | Sin requisitos bloqueantes, puertos libres y DNS válido | Ejecuta el flujo completo. Si ya hay Valet, los pasos se omiten o se repiten de forma segura |
| **Continuar con lo instalado** | Distribución sin gestor compatible y todas las herramientas presentes | Igual, pero omite el paso de paquetes |
| **Cancelar** | Mientras hay una operación en curso | Detiene el comando actual y libera la interfaz. Lo que ya se ejecutó como root puede seguir unos segundos |
| **Reparar DNS** | Valet instalado y modo Seguro o Hosts | Vuelve a aplicar el DNS elegido sin reinstalar Valet |
| **Sincronizar hosts** | Valet instalado y modo Hosts | Regenera el bloque de `/etc/hosts` con los sitios actuales |
| **Desinstalar** | Valet instalado y aislado | Ejecuta `valet uninstall`, retira el DNS del panel y el paquete de Composer aislado |

Cuando el botón está deshabilitado, debajo aparece el motivo concreto y, si se trata de
un requisito, el panel de guía con los comandos.

- **Reparar instalación** no borra proyectos ni copias.
- **Reparar DNS** usa el modo seleccionado en ese momento; el modo Clásico no se puede
  reparar desde el panel.
- **Desinstalar** no elimina un Valet externo.
- El progreso y el registro se conservan al cambiar de sección, pero no se guardan si
  cierras la aplicación. El registro visible se limita a los últimos 60 000 caracteres.

## Después de instalar

Comprueba:

- `valet --version` responde.
- `systemctl is-active nginx` devuelve `active`.
- Hay un servicio PHP-FPM activo.
- `getent hosts valet-dashboard.test` devuelve `127.0.0.1`.
- La pestaña **Sitios** muestra los proyectos de la carpeta registrada.
- El botón **Abrir** de un sitio abre la URL correcta.

> Si usas puertos personalizados, `valet secure`, `valet unsecure` o una reinstalación
> pueden regenerar la configuración de nginx y volver a los puertos 80/443. Vuelve a
> guardar tus puertos en **Puertos** después de esos cambios.

> **Importante:** después de usar el panel, no ejecutes `valet install` ni
> `valet uninstall` desde una terminal. Esas órdenes no llevan la protección DNS del
> dashboard y podrían volver a aplicar el DNS clásico de Valet.

## Desinstalación

El botón **Desinstalar** solo está habilitado si el Valet detectado es el aislado del
panel. El proceso:

1. Aplica la protección DNS y ejecuta `valet uninstall` con la variable segura.
2. Elimina la configuración DNS del panel (Seguro o Hosts).
3. Quita el paquete de Composer del home aislado.

No elimina:

- Tus proyectos.
- Las copias de seguridad de `~/.valet-dashboard/backups`.
- El archivo de configuración `~/.valet-dashboard/config.json`.
- Un Valet externo detectado en el sistema.

Si usaste el modo Clásico, revisa después los restos de DNS de Valet
(`/etc/dnsmasq.d/valet`, `/opt/valet-linux`, `/etc/NetworkManager/conf.d/valet.conf`)
antes de dar por terminada la limpieza.

## Qué no hace el instalador

- No instala ni configura bases de datos, Redis o Apache.
- No instala `pkexec` ni un agente polkit.
- No instala `sudo`.
- No instala versiones adicionales de PHP ni extensiones a medida.
- No configura cortafuegos.
- No crea proyectos Laravel ni registra carpetas existentes; eso se hace desde [Sitios](Sitios).
- No activa HTTPS en sitios; eso se hace desde [Sitios](Sitios).
- No restaura copias de seguridad desde la interfaz.

## Si algo falla

Los errores del preflight y de cada paso aparecen en la página y en el registro. Consulta
[Solución de problemas](Solucion-de-problemas) para los mensajes más habituales y sus
causas.
