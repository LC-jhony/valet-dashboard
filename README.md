# Valet Dashboard

Panel de escritorio (Electron + React 19 + TypeScript) para instalar y gestionar Valet en Linux:
sitios, creación de proyectos Laravel, versiones de PHP, puertos de nginx y servicios del
sistema.

## Documentación
La guía completa está en la [wiki](wiki/Home.md): instalación, interfaz, sitios, PHP,
puertos, servicios, ajustes, seguridad y copias, arquitectura, desarrollo y solución de
problemas.

## Requisitos
- Ubuntu 26.04 LTS (probado) o una distribución con systemd, polkit (`pkexec`) y NetworkManager.
- Node 20+ para desarrollar o empaquetar la app.
- `systemd-resolved` activo para el **modo DNS seguro**. Si no está activo, usa el modo **Hosts**.
- No hace falta instalar Valet, nginx ni Composer a mano: la pestaña **Instalación** lo hace desde el panel.

## Uso
```bash
npm install
npm run dev        # desarrollo
npm run dist       # AppImage + .deb + .rpm en dist/
```

## Instalación desde el panel
La pestaña **Instalación** detecta el sistema y ejecuta pasos idempotentes con registro en vivo:

1. Comprueba puertos 80/443, `systemd-resolved`, `/etc/resolv.conf` y el puerto DNS `5354`.
2. Crea una copia de seguridad en `~/.valet-dashboard/backups/<fecha>/system`.
3. Libera Apache si está marcado y ocupa 80/443.
4. Instala dependencias con `pkexec` y el gestor de la distribución.
5. Instala Valet con un **Composer aislado** en `~/.config/valet-dashboard/composer`.
   No usa ni modifica el Composer global (evita el conflicto con Illuminate 13).
6. Aplica un parche al paquete de Valet para que **no ejecute su instalación DNS**
   cuando se usa el modo seguro o hosts.
7. Ejecuta `valet install` como el usuario actual. Valet eleva solo lo necesario mediante
   un `sudo` auxiliar con `SUDO_ASKPASS`; Valet nunca se ejecuta directamente como root.
8. Configura el DNS y registra la carpeta de proyectos con `valet park`.
9. Verifica nginx, PHP-FPM, `/usr/local/bin/valet` y la resolución de `*.test`.

No se ejecuta `valet trust`: no existe en `cpriego/valet-linux` 2.4.5. Tampoco se usa
`valet uninstall --force`.

> **Importante:** no ejecutes `valet install` ni `valet uninstall` desde una terminal
> después de usar este panel. Esas órdenes no llevan `VALET_DASHBOARD_SAFE_DNS` y
> podrían volver a aplicar el DNS clásico de Valet. Usa siempre los botones del panel.

## Crear proyectos Laravel
La pestaña **Sitios** incluye **Nuevo proyecto** para crear un proyecto Laravel sin salir del
panel:

- Elige el **nombre**, la **carpeta** (selector nativo o ruta aparcada) y la **versión**
  (última estable o una restricción como `12.*`).
- Composer se ejecuta con el `COMPOSER_HOME` aislado y muestra el registro en vivo.
- Si la carpeta es exactamente una ruta aparcada, el sitio aparece al refrescar. Si no, se
  ejecuta `valet link <nombre>` dentro del proyecto.
- Al terminar, el sitio queda seleccionado y puedes abrirlo. El HTTPS se activa después con
  el botón de la fila.
- En modo **Hosts**, pulsa **Sincronizar hosts** después de crear el proyecto para que el
  dominio nuevo resuelva.
- La creación no se puede cancelar a mitad; si falla, revisa el registro del diálogo.

## Modos DNS
- **Seguro (recomendado)**: `dnsmasq` escucha solo en `127.0.0.1:5354` y
  `systemd-resolved` recibe una ruta `~test` en `/etc/systemd/resolved.conf.d/valet-dashboard.conf`.
  No se detiene NetworkManager, no se reescribe `/etc/resolv.conf` y no se desactiva
  `systemd-resolved`. El puerto 5354 se eligió para no chocar con mDNS/Avahi (5353).
- **Hosts**: no hay daemon DNS. La app sincroniza un bloque gestionado en `/etc/hosts`
  con los sitios de Valet. Úsalo si `systemd-resolved` no está activo o si algo ocupa 5354.
  Tras enlazar un sitio desde la terminal, pulsa **Sincronizar hosts**.
- **Clásico**: deja que Valet instale su propio DNS. Puede detener `systemd-resolved`,
  reescribir `/etc/resolv.conf`, tocar NetworkManager y cortar WiFi/DNS. Solo para
  diagnóstico avanzado; el modo seguro es el valor por defecto.

Antes de cualquier cambio de red se guarda una copia en
`~/.valet-dashboard/backups/<fecha>/dns`. El instalador comprueba que `*.test` resuelva
y que el DNS general siga funcionando; si falla, retira su configuración y reinicia
`systemd-resolved`.

## Estructura
- `src/main`: proceso principal; comandos con `execFile` y arrays de argumentos (sin shell).
  Los paquetes, copias y DNS usan `pkexec`; Valet usa su propio `sudo` con `askpass`.
- `src/preload`: API mínima expuesta con `contextBridge` (`window.api`).
- `src/shared/types.ts`: contrato IPC tipado.
- `src/renderer`: interfaz React.

## Interfaz
La ventana usa un shell tipo VS Code: una **barra de actividad** a la izquierda con las
secciones (Sitios, PHP, Puertos, Servicios e Instalación) y **Ajustes** al pie; un
**panel lateral contextual**; y una **barra de estado** inferior con la versión de PHP,
el recuento de sitios y, cuando se han cargado, los puertos y los servicios activos.

- Arrastra el borde derecho del panel para redimensionarlo (220–420 px). El ancho se recuerda.
- `Ctrl+B` muestra u oculta el panel; `Ctrl+,` abre Ajustes; `Ctrl+1`…`Ctrl+5` cambia de sección.
- En **Sitios**, **Nuevo proyecto** abre el diálogo de creación con registro de Composer.
- Por debajo de 900 px el panel se convierte en una capa superpuesta.
- La página de Instalación sigue activa al cambiar de sección: el progreso y el registro no se pierden.

## Copias, reparación y desinstalación
- Cada instalación guarda copias de `/etc/nginx`, `/etc/php`, `/etc/apache2`, DNS,
  `/etc/hosts` y `/usr/local/bin/valet` en `~/.valet-dashboard/backups`.
- **Reparar DNS** vuelve a aplicar el modo elegido sin reinstalar Valet.
- **Desinstalar** ejecuta `valet uninstall` (sin `--force`) con la protección DNS,
  elimina el servicio DNS del dashboard y quita el paquete del Composer aislado.
  No desinstala un Valet externo detectado fuera del Composer del dashboard.
  Si instalaste el modo **clásico**, revisa después los restos de DNS de Valet
  (`/etc/dnsmasq.d/valet`, `/opt/valet-linux`, `/etc/NetworkManager/conf.d/valet.conf`).
- Si un paso falla, corrige la causa y pulsa **Reparar instalación**. Los pasos ya
  completados se omiten o se repiten sin duplicar configuración.

## Notas importantes
- **Puertos**: se reescriben las directivas `listen` en `~/.valet/Nginx/*` y
  `/etc/nginx/sites-available/valet.conf` con copia previa en `~/.valet-dashboard/backups`.
  Valet regenera estos archivos tras `valet secure`/`install`; vuelve a guardar los puertos.
- `valet secure` y `valet use` se lanzan como el usuario actual; Valet eleva internamente
  lo necesario con el `sudo` auxiliar. La app conserva el modelo de permisos de Valet.
- El Composer global no se toca. Para ver el Valet del dashboard:
  `~/.config/valet-dashboard/composer/vendor/bin/valet --version`.

## Ajustes y temas
El botón **Ajustes** permite elegir tema Sistema/Claro/Oscuro, paleta (Carbon o Min),
iconos de archivos, fuente, tamaño de texto y vista compacta. También puedes alternar
claro/oscuro desde la barra de estado. Se guarda en el navegador de la app.
Las paletas salen de los temas de VS Code en `src/renderer/themes/`; los iconos de
`src/renderer/file-icons/` solo se empaquetan si la interfaz los usa.

## Puertos y Apache
La pestaña **Puertos** permite cambiar HTTP/HTTPS de Valet (nginx) y de Apache:

- Comprueba que el puerto esté libre y avisa si lo ocupa otro proceso.
- Valida con `nginx -t` o `apache2ctl configtest`, guarda copias y restaura si la recarga falla.
- Si Apache ocupa 80/443 puedes moverlo a 8080/8443 o detenerlo desde la tarjeta,
  sin deshabilitar dnsmasq ni tocar la configuración de red.
- No se permite usar 53, 67, 68, 123, 5353 ni 5354 para nginx.
