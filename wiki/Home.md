# Valet Dashboard

Panel de escritorio para **instalar y gestionar Valet Linux** desde una interfaz gráfica.
Está construido con Electron, React 19 y TypeScript, y está pensado para distribuciones
Linux con `systemd`, `polkit` y, preferiblemente, NetworkManager.

> **Versión documentada:** 0.1.0 · **Interfaz:** español · **Plataforma:** Linux

## Qué puedes hacer

| Área | Acciones principales | Página |
|---|---|---|
| **Instalación** | Detectar el sistema, instalar Valet con Composer aislado, elegir modo DNS, reparar DNS, sincronizar hosts y desinstalar | [Instalación](Instalacion) |
| **Sitios** | Ver sitios *parked* y *linked*, crear proyectos Laravel, buscar, activar/quitar HTTPS y abrir el sitio en el navegador | [Sitios](Sitios) |
| **PHP** | Ver las versiones de PHP-FPM instaladas y cambiar la versión en uso | [PHP](PHP) |
| **Puertos** | Cambiar puertos de nginx y Apache, ver puertos en escucha y detectar conflictos | [Puertos](Puertos) |
| **Servicios** | Iniciar, detener y reiniciar nginx, Apache, DNS, PHP-FPM, MySQL, Redis, etc. | [Servicios](Servicios) |
| **Ajustes** | Tema claro/oscuro, paletas, iconos, tipografía, tamaño de texto y vista compacta | [Ajustes](Ajustes) |
| **Seguridad** | Copias de seguridad, reversión automática y modelo de permisos | [Seguridad y copias](Seguridad-y-copias) |

## Primeros pasos

1. **Instala el panel** desde su paquete (`.deb`, `.rpm` o AppImage). El panel arranca
   aunque no haya nada instalado: no necesita Valet, nginx ni PHP para abrirse.
2. Abre la pestaña **Instalación** y revisa el diagnóstico del sistema. Las herramientas
   que faltan aparecen marcadas como **falta**.
3. Elige el **modo DNS** (el panel recomienda uno), la carpeta de proyectos y las
   opciones. Pulsa **Instalar Valet**.
4. Cuando termine, entra en **Sitios** y pulsa **Nuevo proyecto** para crear uno con
   Composer, o coloca tus proyectos en la carpeta indicada (por defecto `~/Sites`) y
   regístralos con `valet park` o `valet link` desde una terminal.
5. Vuelve a **Sitios**, pulsa **Actualizar** y usa **Abrir** o **Activar HTTPS**.

> El panel crea proyectos Laravel nuevos, pero no elimina sitios ni registra carpetas
> existentes. Para esas tareas se usan los comandos de Valet (`valet park`, `valet link`,
> `valet unlink`). Consulta [Sitios](Sitios#crear-un-proyecto-laravel) y
> [Sitios](Sitios#añadir-y-quitar-sitios-existentes).

## La interfaz en 30 segundos

- **Barra de actividad** (izquierda): Sitios, PHP, Puertos, Servicios, Instalación y Ajustes.
- **Panel lateral contextual**: búsqueda de sitios, versiones PHP, tarjetas de puertos,
  lista de servicios o diagnóstico de instalación.
- **Área principal**: la página de la sección con sus listas, formularios, botones y avisos.
- **Barra de estado** (abajo): versión de PHP, estado de nginx, puertos, número de sitios,
  servicios activos y cambio rápido de tema.

Detalles en [Interfaz](Interfaz).

## Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl+B` | Mostrar u ocultar el panel lateral |
| `Ctrl+,` | Abrir Ajustes |
| `Ctrl+1` | Ir a Sitios |
| `Ctrl+2` | Ir a PHP |
| `Ctrl+3` | Ir a Puertos |
| `Ctrl+4` | Ir a Servicios |
| `Ctrl+5` | Ir a Instalación |
| `Esc` | Cerrar Ajustes o el panel lateral en pantallas pequeñas |

En macOS también funciona `Cmd` en lugar de `Ctrl`. La app está orientada a Linux.

## Dónde se guarda la información

| Ruta | Contenido |
|---|---|
| `~/.valet/config.json` | Dominio de Valet (por defecto `test`) y rutas *parked* |
| `~/.valet/Sites/` | Enlaces creados con `valet link` |
| `~/.valet/Certificates/` | Certificados de los sitios con HTTPS |
| `~/.valet-dashboard/config.json` | Puertos guardados por el panel |
| `~/.valet-dashboard/backups/` | Copias de seguridad de sistema, DNS y puertos |
| `~/.valet-dashboard/bin/` | Ayudantes de contraseña y scripts de DNS/backup |
| `~/.config/valet-dashboard/composer/` | Composer aislado del panel |

Más detalle en [Seguridad y copias](Seguridad-y-copias).

## Limitaciones conocidas

- Solo Linux con `systemd` y `polkit`. No funciona en Windows ni macOS.
- La instalación automática requiere una distribución con `apt`, `dnf` o `pacman`.
- Crea proyectos Laravel nuevos, pero no elimina sitios, enlaces ni proxies ni registra
  carpetas existentes.
- No instala servidores de bases de datos, Redis ni Apache; solo los gestiona si existen.
- No tiene actualización automática ni botón para restaurar copias de seguridad.
- El soporte de Apache está orientado a la ruta Debian `/etc/apache2`.
- La instalación y la desinstalación automáticas están pensadas para el Valet aislado
  del panel; un Valet externo se detecta, pero no se desinstala.

Lista completa en [Solución de problemas](Solucion-de-problemas#limitaciones-conocidas).

## Índice de la wiki

- [Instalación](Instalacion)
- [Interfaz](Interfaz)
- [Sitios](Sitios)
- [PHP](PHP)
- [Puertos](Puertos)
- [Servicios](Servicios)
- [Ajustes](Ajustes)
- [Seguridad y copias](Seguridad-y-copias)
- [Solución de problemas](Solucion-de-problemas)
- [Glosario](Glosario)
- [Arquitectura](Arquitectura)
- [Desarrollo y empaquetado](Desarrollo)
