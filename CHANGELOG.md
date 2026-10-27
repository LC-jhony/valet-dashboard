# Registro de cambios

Todos los cambios relevantes de este proyecto se anotan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado
[SemVer](https://semver.org/lang/es/).

## [Sin publicar]

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

- `npm audit` informa de 21 avisos en dependencias de desarrollo (tinypool,
  node-gyp, cacache, tar). No afectan al binario distribuido y no se fuerzan
  porque exigirían subir a `vite` 6, incompatible con `electron-vite` 2.
- Si `htpasswd` no está instalado, la protección de Mailpit sigue funcionando en
  modo texto plano con el fichero en `0600`.

[Sin publicar]: https://github.com/LC-jhony/valet-dashboard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/LC-jhony/valet-dashboard/releases/tag/v0.1.0
