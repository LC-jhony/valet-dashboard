# Registro de cambios

Todos los cambios relevantes de este proyecto se anotan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado
[SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Añadido

- Asistente **Nuevo proyecto** con el instalador oficial de Laravel (`laravel new`):
  starter kit y autenticación, stack de frontend, pruebas, Boost, gestor de Node, Git y
  base de datos. Las preguntas cambian según las respuestas.
- Detección real de capacidades: versión del instalador, flags que admite, extensiones
  `pdo_*` y gestores de Node disponibles. Los motores sin extensión aparecen
  deshabilitados.
- Instalación automática de `laravel/installer` en el Composer aislado si no hay uno
  global, sin tocar el Composer del usuario.
- Base de datos con credenciales por entorno del proceso: el instalador ejecuta las
  migraciones sin que la contraseña aparezca en los argumentos ni en el registro; después
  se escriben en `.env` y los valores no secretos en `.env.example`.
- **Detener** cancela el grupo completo del instalador (Composer, PHP y Node).
- **Eliminar carpeta incompleta** tras un fallo, limitado a la última carpeta creada y con
  comprobaciones para no tocar enlaces de Valet ni sitios registrados.
- Guía de requisitos previos en la pestaña **Instalación**: cada bloqueo muestra su causa,
  el comando exacto para resolverlo y un botón para copiarlo, con **Volver a comprobar**.
- Elevación con alternativa: si falta `pkexec`, el panel usa `/usr/bin/sudo -A` con el
  diálogo de contraseña. La guía solo bloquea cuando no hay ninguna forma de elevar.
- El botón de instalar explica el motivo cuando está deshabilitado.
- Diagnóstico de errores del gestor de paquetes: bloqueo de dpkg, disco lleno, red caída,
  paquete inexistente, conflictos, autenticación cancelada y tiempo agotado.
- Botón **Cancelar** durante una instalación; libera la interfaz.
- Prueba de humo al final de la instalación: crea un sitio temporal, pide su `index.php`
  por HTTP y distingue 502 (PHP-FPM), 404 (nginx) y 000 (nginx caído).
- Instalación manual en distribuciones sin `apt`/`dnf`/`pacman`: si las herramientas ya
  están, el flujo continúa y omite el paso de paquetes. El botón pasa a
  **Continuar con lo instalado**.
- Aviso cuando la versión de PHP del CLI no tiene un PHP-FPM instalado.

### Cambiado

- Interfaz más plana: el área de trabajo pierde margen y borde, los radios bajan a
  4–14 px, las filas dejan de ser tarjetas y las acciones de cada fila pasan a estilo
  fantasma. Etiquetas, segmentos y previsualizaciones pierden el borde y usan un fondo
  suave.
- Los estados hover siguen una sola regla: fondos neutros para lo secundario, relleno más
  oscuro para el botón primario y ningún cambio sobre controles deshabilitados. Todos
  comparten la transición `--t` de 120 ms.
- El texto de acento, aviso y verde se calcula por tema para llegar a AA sobre su propio
  tinte: en claro el rojo pasa de 2,8:1 a 4,9:1 y el ámbar de aviso de 3,1:1 a 4,6:1. Los
  grises secundarios del tema Min también suben al mínimo legible.
- El tema Min oscuro usa un azul de relleno (`#0E639C`) en los controles primarios: su
  azul claro no admitía texto blanco, así que el botón llevaba texto negro.
- El tamaño de texto de Configuración escala toda la interfaz. Antes solo crecían los
  títulos: de 100 declaraciones de `font-size`, 89 eran píxeles fijos. Ahora hay cuatro
  tamaños derivados de `--fs`, con suelos para no bajar de 9 px, y las alturas de
  botones, campos, etiquetas y barras salen del mismo valor.
- El espaciado sigue una rejilla de 4 px, con 1 y 2 px reservados para ajustes ópticos, y
  los interlineados bajan de siete valores a tres: títulos, interfaz y texto largo.
- El modo compacto aprieta de verdad: además de filas y paneles, reduce las alturas de
  control y las barras mediante el token `--dense`.
- La sección **Red y DNS** de Instalación explica antes de elegir: qué es el DNS, qué hace
  cada modo, qué toca del sistema y qué riesgo tiene. **Seguro** (dnsmasq propio en
  127.0.0.1:5354 con una ruta en systemd-resolved) y **Hosts** (`/etc/hosts`) se presentan
  como las dos opciones que no tocan la red, y **Clásico** avisa de que puede dejar sin
  WiFi hasta reiniciar. Los modos son tarjetas de opción, con la recomendada marcada, y
  uno no disponible dice el motivo en vez de quedar solo deshabilitado. Las comprobaciones
  del equipo dejan de ser iconos: cada una dice qué se ha encontrado. **Reparar DNS** y
  **Sincronizar hosts** se mudan a esta sección, junto al modo al que afectan.
- La pestaña **Correo** deja de ser una sucesión de tarjetas y pasa a ser un visor. Una
  barra compacta reúne estado, versión, protección y contadores, con los endpoints en dos
  chips de dos líneas que ya no truncan las URLs; debajo, las acciones en su propia fila,
  los avisos en una línea cada uno y la interfaz de Mailpit con una barra de navegador que
  muestra la URL y **Abrir en el navegador**. El visor es cuadrado, porque la vista es una
  superficie nativa que no admite esquinas redondeadas, y crece con la ventana en lugar de
  tener un alto fijo. Se retiran las tarjetas de estadísticas y los avisos duplicados de la
  barra lateral.
- Los controles rellenos (botón **Nuevo proyecto** y segmentos activos) usan un rojo más
  profundo con texto blanco: el rojo de marca sobre fondo oscuro no admitía blanco con
  contraste AA, así que el acento queda para iconos, bordes y texto, y el relleno usa
  `--accent-fill`.
- La creación de proyectos usa `laravel new` en lugar de `composer create-project`. Solo
  se ofrece la última versión estable: el instalador no acepta una restricción.
- Tras crear el proyecto se ajusta `APP_URL` en `.env` con el dominio y el puerto reales
  de nginx, aunque el instalador los hubiera dejado por defecto.
- El paso de dependencias consulta qué falta antes de ejecutar el gestor de paquetes, así
  que «Reparar instalación» termina en segundos cuando todo está instalado.
- Se instala `php-sqlite3` (y `php-process` y `php-pdo` en Fedora), necesario para las
  migraciones de Laravel 11 y posteriores y para `ext-posix` de Valet.
- `valet install` se valida con `nginx -t` antes de continuar.
- Los comandos tienen un tiempo máximo de 15 minutos y el error lo explica.

## [0.1.0] — 2026-10-27

Primera versión publicada. Recoge el panel completo, la integración de Mailpit y
el endurecimiento de seguridad del proceso principal.

### Añadido

- Panel de escritorio en Electron + React para gestionar Valet Linux: sitios,
  puertos, servicios, DNS, certificados y creación de proyectos Laravel.
- Integración de Mailpit: instalar, arrancar, parar, actualizar y abrir la
  interfaz; estado del servidor SMTP y del buzón.
- Configuración de Mailpit por pestañas (SMTP, interfaz, relay, caos, etiquetas,
  webhook), con las opciones avanzadas plegadas y validadas contra `mailpit --help`.
- Integraciones de Mailpit para Laravel (`MAIL_*` en `.env` y `mail.php`) y
  WordPress (constantes de `wp-config.php`).
- Ventana modal compartida (`Modal.tsx`) con foco atrapado, cierre por capas y
  fondo `inert`, usada por los cuatro diálogos de la aplicación.
- Wiki en español: 21 páginas, con la sección de Correo (6 páginas) y 25 capturas.
- Integración continua en GitHub Actions: `typecheck`, pruebas y build en Node;
  `gofmt`, `go vet` y pruebas en Go.
- 47 pruebas de interfaz y proceso principal (rutas seguras, guardas de ventana,
  `htpasswd`, ayudantes de root, configuración de Mailpit, contraste del tema) y
  pruebas Go para Quadlet, servicios y entorno.

### Seguridad

- Política de rutas en el proceso principal: `safe-path.ts` confina las
  operaciones de `uninstall` y de los registros a los directorios permitidos.
- `assertTrusted` valida el remitente de cada mensaje IPC; se añaden guardas
  `will-navigate`, `will-redirect`, `setWindowOpenHandler` y
  `will-attach-webview` en `window-guard.ts`.
- Los secretos dejan de viajar en `argv`: `htpasswd -niB` y `tee` reciben los
  datos por entrada estándar mediante `runInput`.
- Los ayudantes que se ejecutan como root se instalan en
  `/usr/local/libexec/valet-dashboard` con propietario `root` y modo `0755`.
- `.env` y `php.ini` se escriben con modo `0600`; las unidades Quadlet que
  contienen secretos también, y `HealthCmd` ya no incluye la contraseña.
- `service.Start` guarda la unidad antes de arrancarla para no dejar un servicio
  a medias si falla la escritura.

### Cambiado

- Los atajos de teclado se ignoran mientras hay un diálogo abierto.
- Los rótulos de Mailpit describen lo que la opción hace de verdad
  (`MP_TAG`, `MP_CHAOS_TRIGGERS`, `MP_SMTP_RELAY_MATCHING`, `MP_WEBHOOK_LIMIT`).
- El botón «Usar el del sistema» aparece cuando la instalación gestionada no es
  la que está en uso.
- El color de texto sobre el color de acento se elige por contraste WCAG real.

### Notas

- El `.rpm` se empaqueta con `scripts/build-rpm.sh` y `build/rpm/valet-dashboard.spec`:
  electron-builder 25 usa fpm 1.9.3, que pasa un `--define buildroot` que rpm 6
  ignora, y cada fichero acaba en «File not found». El payload es el mismo.
- `npm audit` informa de 21 avisos en dependencias de desarrollo (tinypool,
  node-gyp, cacache, tar). No afectan al binario distribuido y no se fuerzan
  porque exigirían subir a `vite` 6, incompatible con `electron-vite` 2.
- Si `htpasswd` no está instalado, la protección de Mailpit sigue funcionando en
  modo texto plano con el fichero en `0600`.

[Sin publicar]: https://github.com/LC-jhony/valet-dashboard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/LC-jhony/valet-dashboard/releases/tag/v0.1.0
