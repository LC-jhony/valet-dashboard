# Valet Dashboard

Panel de escritorio (Electron + React 19 + TypeScript) para gestionar Valet en Linux:
sitios, versiones de PHP, puertos de nginx y servicios del sistema.

## Requisitos
- Node 20+, `valet` (valet-linux o un fork activo) en el PATH, nginx, systemd y polkit (`pkexec`).
- Ejecuta `valet trust` una vez: así `valet use`/`secure` no piden contraseña en una terminal que la app no tiene.
- Las rutas y servicios asumen Debian/Ubuntu (`php8.x-fpm`, `/etc/nginx/sites-available/valet.conf`). Para Fedora/Arch ajusta `src/main/valet.ts`.

## Uso
```bash
npm install
npm run dev        # desarrollo
npm run dist       # AppImage + .deb + .rpm en dist/
```

## Estructura
- `src/main`: proceso principal; todos los comandos usan `execFile` con argumentos (sin shell) y `pkexec` para lo privilegiado.
- `src/preload`: API mínima expuesta con `contextBridge` (`window.api`).
- `src/shared/types.ts`: contrato IPC tipado.
- `src/renderer`: interfaz React.

## Interfaz
La ventana usa un shell tipo VS Code: una **barra de actividad** a la izquierda con las secciones (Sitios, PHP, Puertos, Servicios e Instalación) y **Ajustes** al pie; un **panel lateral contextual** con la lista de la sección activa; y una **barra de estado** inferior con la versión de PHP, el recuento de sitios y, cuando se han cargado, los puertos y los servicios activos, además de un botón para cambiar entre tema claro y oscuro. Las superficies, botones, campos y diálogos usan bordes redondeados y todos los colores, sombras y overlays se adaptan al tema activo (Carbon o Min, en claro u oscuro). La ventana no muestra la barra de menú nativa de Electron: toda la navegación está en la barra de actividad y en el panel lateral.

- Arrastra el borde derecho del panel para redimensionarlo (220–420 px). El ancho se recuerda entre sesiones.
- `Ctrl+B` muestra u oculta el panel; `Ctrl+,` abre Ajustes; `Ctrl+1`…`Ctrl+5` cambia de sección.
- Por debajo de 900 px el panel se convierte en una capa superpuesta con fondo oscurecido; se cierra al elegir un elemento, con `Esc` o pulsando fuera. Las filas y los formularios se apilan en pantallas estrechas.
- La página de Instalación sigue activa al cambiar de sección, de modo que el progreso y el registro no se pierden.

## Notas importantes
- **Puertos**: se reescriben las directivas `listen` en `~/.valet/Nginx/*` y `/etc/nginx/sites-available/valet.conf` (con copia previa en `~/.valet-dashboard/backups`). Valet regenera estos archivos con `valet secure`/`install`, así que tras esas operaciones vuelve a guardar los puertos. Verifica la ruta del vhost con `ls /etc/nginx/sites-available`.
- Revisa que tu fork de Valet acepte `valet use php@8.x`.

## Siguientes pasos
Composer, Node (fnm), MySQL (crear/borrar bases de datos), PHP por sitio (`valet isolate`), logs en vivo con `journalctl -fu`.

## Pestaña Instalación
Diagnostica el sistema (distro, PHP, Composer, nginx, dnsmasq, puertos 80/443) e instala Valet en pasos con registro en vivo:
dependencias (`pkexec` + apt/dnf/pacman) → `composer global require` → PATH → `valet trust` → `valet install` → `valet park` → verificación.
Cada paso es idempotente; si uno falla, corrige la causa y pulsa «Reparar instalación».
Para que Valet pueda usar `sudo` sin terminal, la app crea un `sudo` y un `askpass` temporales en `~/.valet-dashboard/bin` (requiere `zenity` o `kdialog`).
Antes de desinstalar, comprueba que `valet uninstall --force` existe en tu fork (`valet list`).

## Ajustes y temas
El botón **Ajustes** (parte inferior de la barra de actividad) permite elegir tema Sistema/Claro/Oscuro, paleta (Carbon o Min), **iconos de archivos** (Dawn, Deep, Dim o You, con variante clara/oscura automática), fuente (del sistema, monoespaciada, serif u otra instalada), tamaño de texto y vista compacta. También puedes alternar claro/oscuro desde la barra de estado. Se guarda en el navegador de la app y se aplica al instante.
Las paletas salen de los temas de VS Code en `src/renderer/themes/` (colores en `src/renderer/theme.ts`). Algunos tonos que esos temas no definen (fondos de tarjetas, color de «ok» en Min Dark, aviso en Carbon) son derivados. Los iconos se toman de `src/renderer/file-icons/` y solo se empaquetan los que usa la interfaz.

## Puertos y Apache
La pestaña **Puertos** permite cambiar manualmente HTTP/HTTPS de Valet (nginx) y de Apache:

- Antes de guardar comprueba que el puerto esté libre y avisa si lo ocupa otro proceso (por ejemplo Apache en 80/443).
- Valida con `nginx -t` o `apache2ctl configtest`, guarda copias en `~/.valet-dashboard/backups` y restaura la configuración anterior si la recarga falla.
- Si Apache ocupa 80/443 puedes moverlo a 8080/8443 o detenerlo desde la misma tarjeta, sin deshabilitar dnsmasq ni tocar la configuración de red.
- Con puertos personalizados, abre los sitios como `sitio.test:8080` (y `https://sitio.test:8443`).
- `valet secure`/`valet install` pueden regenerar los vhosts con 80/443; vuelve a guardar los puertos después.

