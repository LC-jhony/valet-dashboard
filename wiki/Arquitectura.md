# Arquitectura

Valet Dashboard es una aplicación de escritorio **Electron + React + TypeScript**. No tiene
servidor propio ni base de datos: el proceso principal lee archivos, ejecuta comandos del
sistema y expone una API pequeña a la interfaz.

## Tecnologías

| Componente | Versión / herramienta |
|---|---|
| Electron | 33 |
| React | 19 |
| TypeScript | 5.9, modo `strict` |
| Empaquetado de desarrollo | electron-vite 2 + Vite 5 |
| Empaquetado de distribución | electron-builder 25 |
| Estilos | CSS propio con variables |
| Iconos | SVG empaquetados; glifos de interfaz en React |

## Modelo de procesos

```text
┌──────────────────────────────────────────────────────────────┐
│ Proceso principal (Node)                                     │
│  index.ts · valet.ts · install.ts · exec.ts · helpers.ts     │
│  - ventana y ciclo de vida                                   │
│  - IPC                                                       │
│  - comandos con execFile/spawn (sin shell)                   │
│  - archivos, backups, pkexec                                 │
└───────────────▲──────────────────────────────┬───────────────┘
                │ ipcMain.handle               │ webContents.send
                │                              │ install:event
┌───────────────┴──────────────┐   contextBridge│
│ Preload                      │   window.api   │
│  API fija y tipada           │───────────────►│
└───────────────▲──────────────┘                │
                │                               │
┌───────────────┴───────────────────────────────▼───────────────┐
│ Renderer (React, sandbox, sin Node)                          │
│  App.tsx · CreateProjectDialog.tsx · SettingsDialog.tsx      │
│  theme.ts · icons.tsx                                        │
└──────────────────────────────────────────────────────────────┘
```

- **Main**: tiene acceso completo a Node. Es el único que ejecuta comandos y escribe
  archivos.
- **Preload**: se ejecuta antes que la página y expone `window.api` con `contextBridge`.
  No expone `ipcRenderer` ni módulos de Node.
- **Renderer**: interfaz React. Solo usa `window.api` y `localStorage`.

La seguridad de la ventana se detalla en [Seguridad y copias](Seguridad-y-copias).

## Estructura del código

```text
src/
├── main/
│   ├── index.ts       Ventana, menú, registro de IPC y eventos
│   ├── valet.ts       Sitios, proyectos Laravel, PHP, puertos y servicios
│   ├── laravel-installer.ts  Localiza/instala `laravel new`, capacidades y ejecución
│   ├── install.ts     Diagnóstico, instalación, DNS, backups y desinstalación
│   ├── mailpit.ts     Ciclo de vida, descarga, systemd, health y API de Mailpit
│   ├── mailpit-config.ts  Configuración, auth, TLS, env, YAML y unidad de Mailpit
│   ├── mailpit-project.ts Integración con Laravel (.env) y sendmail de PHP
│   ├── exec.ts        execFile, rutas de la app y helper de pkexec
│   └── helpers.ts     askpass, envoltorio de sudo y entorno de Valet
├── preload/
│   └── index.ts       contextBridge → window.api
├── shared/
│   ├── types.ts       Contrato IPC y tipos de datos
│   ├── laravel.ts     Modelo puro del asistente: respuestas, flags, validación y .env
│   └── mailpit.ts     Contrato y esquema de opciones MP_* de Mailpit
└── renderer/
    ├── main.tsx       Punto de entrada; aplica ajustes antes de renderizar
    ├── App.tsx        Shell, páginas, paneles y barra de estado
    ├── CreateProjectDialog.tsx
    ├── SettingsDialog.tsx
    ├── mail/          Página Correo, diálogos y controles de Mailpit
    ├── theme.ts       Ajustes, paletas, fuentes y persistencia
    ├── icons.tsx      Iconos de archivos y variantes claro/oscuro
    ├── ui-icons.tsx   Glifos SVG de la interfaz
    ├── styles.css     Variables, layout y componentes
    ├── themes/        JSON de las paletas Carbon y Min
    └── file-icons/    SVG de Dawn, Deep, Dim y You
```

## Responsabilidades

### `src/main/index.ts`

- Asigna el nombre `Valet Dashboard` y carga el icono.
- Registra todos los canales IPC.
- Crea la ventana de 1100 × 720, mínimo 760 × 520, con sandbox, aislamiento de contexto y
  sin integración de Node.
- Elimina el menú de la aplicación.
- Carga la URL de desarrollo (`ELECTRON_RENDERER_URL`) o el HTML compilado.
- Cierra la aplicación cuando se cierra la última ventana.

### `src/main/valet.ts`

- **Sitios**: lee `~/.valet/config.json`, las rutas aparcadas y `~/.valet/Sites`; detecta
  certificados; calcula la URL con esquema y puerto reales; ordena y deduplica.
- **Proyectos Laravel**: valida nombre, carpeta y respuestas del asistente; comprueba
  Valet; localiza el instalador (`laravel`) o lo instala en el Composer aislado; ejecuta
  `laravel new` en un grupo de procesos propio con opciones explícitas y credenciales por
  entorno; emite el registro en vivo; enlaza con `valet link` si la carpeta no está
  aparcada; parchea `.env`; permite cancelar y borrar la carpeta incompleta.
- **PHP**: detecta `php-fpmX.Y` en `/usr/sbin` y `/usr/bin`; obtiene la versión actual de
  PHP CLI; ejecuta `valet use php@X.Y`.
- **Puertos de nginx**: localiza `~/.valet/Nginx/*.conf` y
  `/etc/nginx/sites-available/valet.conf`; lee las directivas `listen`; sustituye puertos;
  guarda copias; valida con `nginx -t`; recarga o inicia nginx; revierte si falla.
- **Puertos de Apache**: lee `/etc/apache2/ports.conf`, `sites-enabled` y
  `sites-available`; interpreta `Listen` y `<VirtualHost ...:puerto>`; valida con
  `apache2ctl configtest`; revierte si falla.
- **Servicios**: filtra unidades permitidas y consulta su estado; ejecuta acciones con
  `pkexec systemctl`.

### `src/main/mailpit-config.ts`

- Define rutas: configuración, entorno, auth, TLS, YAML, binario y unidad.
- Carga, valida y guarda `mailpit.json`; expande `~` y limita claves a `MP_*`.
- Genera `mailpit.env` con comillas seguras para systemd.
- Escribe archivos de contraseñas (bcrypt con `htpasswd` o texto plano `0600`).
- Genera el certificado autofirmado con `openssl`.
- Escribe la unidad `valet-dashboard-mailpit.service` y los YAML auxiliares.

### `src/main/mailpit.ts`

- Detecta el binario gestionado o del sistema y consulta su versión.
- Descarga el release de GitHub, verifica el `digest` SHA-256 y extrae el binario con
  `tar`; conserva `mailpit.prev` para revertir.
- Arranca, detiene y reinicia la unidad con `systemctl --user`; habilita el arranque si se
  pide.
- Aplica la configuración, espera a `/livez` y revierte si no queda saludable.
- Consulta `/api/v1/info`, vacía el buzón, envía correo de prueba y lee el registro.
- Emite eventos de estado, progreso y registro al renderer.

### `src/main/mailpit-project.ts`

- Escribe `MAIL_*` en el `.env` del sitio con copia previa y sin tocar el resto de claves.
- Lee y escribe `sendmail_path` en `fpm/php.ini` y `cli/php.ini` mediante `pkexec`.
- Guarda copias, valida con `php-fpmX.Y -t`, reinicia PHP-FPM y revierte si falla.
- Prueba `mail()` y comprueba que el contador de mensajes de Mailpit aumenta.

### `src/main/install.ts`

- **Diagnóstico** (`checkEnv`): distribución, gestor de paquetes, herramientas, puertos
  80/443, estado de DNS, conflictos de Composer, Valet aislado o externo, advertencias y
  modo DNS recomendado.
- **Instalación** (`startInstall`): ejecuta pasos idempotentes y emite eventos de plan,
  estado y registro.
- **DNS** (`repairDns`, `syncHosts`): aplica el modo Seguro o Hosts y verifica la
  resolución.
- **Desinstalación** (`startUninstall`): solo para el Valet aislado; ejecuta
  `valet uninstall` con protección DNS, retira el DNS del panel y quita el paquete de
  Composer.
- **Scripts**: contiene los scripts Bash de DNS y backup que escribe en
  `~/.valet-dashboard/bin/`.
- **Parche DNS**: modifica `DnsMasq.php` del paquete de Valet para respetar
  `VALET_DASHBOARD_SAFE_DNS`.

### `src/main/exec.ts`

- Define `APP_DIR` (`~/.valet-dashboard`), `COMPOSER_HOME`
  (`~/.config/valet-dashboard/composer`) y `COMPOSER_BIN`.
- Construye un `PATH` con el Composer aislado y las rutas del sistema.
- Expone `run` y `runWithEnv` basados en `execFile`, con timeout de 10 minutos y `cwd`
  opcional.
- Expone `sudo`, que ejecuta `pkexec` con el comando y sus argumentos.

### `src/main/helpers.ts`

- Crea `askpass` y el envoltorio `sudo` para Valet.
- Define `privilegedEnv`, que añade `SUDO_ASKPASS` y el `PATH` de los ayudantes.
- Expone `runValet`, que ejecuta Valet como el usuario actual y admite un `cwd` para
  `valet link`.

### `src/preload/index.ts`

Traduce cada método de `Api` a `ipcRenderer.invoke` con un canal fijo. Para los eventos de
instalación se suscribe a `install:event`, para los de creación de proyectos a
`sites:create-event` y para los de Mailpit a `mailpit:event`; en todos los casos devuelve
una función para desuscribirse. `mailpit:view` es un canal `send` para mover y ocultar la
vista embebida, y `mailpit:shortcut` reenvía los atajos capturados dentro de Mailpit.

### `src/shared/types.ts`

Es el contrato único entre main, preload y renderer. Incluye `Api`, `Site`, `ProjectInfo`,
`CreateProjectOptions`, `CreateProjectEvent`, `PortsInfo`, `PhpInfo`, `Service`, `Env`,
`InstallOptions` e `InstallEvent`. `CreateProjectOptions` lleva las respuestas del
asistente y las credenciales de base de datos; el modelo puro que las valida y traduce a
flags vive en `src/shared/laravel.ts`. `Api.mailpit` reexporta el contrato de
`src/shared/mailpit.ts`, que también define los grupos, campos, defaults y helpers del
esquema `MP_*`.

### `src/renderer`

- `App.tsx` contiene el shell y las seis páginas: Sitios, PHP, Puertos, Servicios,
  Instalación y Correo, además de los paneles laterales y la barra de estado.
- `mail/` contiene `MailpitPage.tsx` (página y vista embebida), `MailpitSettingsDialog.tsx`
  (formulario `MP_*`, auth, TLS y YAML), `MailpitIntegrationsDialog.tsx` (Laravel, PHP,
  registro y desinstalación) y `options.tsx` (controles del esquema).
- `theme.ts` define los ajustes, las paletas, las fuentes y su persistencia.
- `CreateProjectDialog.tsx` es el diálogo de creación de proyectos Laravel: formulario,
  registro en vivo, error y éxito.
- `errors.ts` normaliza los mensajes de error de IPC (quita el prefijo en inglés de
  Electron).
- `SettingsDialog.tsx` es el diálogo de apariencia.
- `icons.tsx` resuelve el icono de archivo según tema y modo claro/oscuro.
- `ui-icons.tsx` dibuja los glifos de la interfaz.
- `styles.css` usa variables CSS (`--bg`, `--panel`, `--ink`, `--accent`, `--fs`, etc.) y
  aplica la vista compacta con `[data-compact="true"]`.

## Canales IPC

Todos los canales se registran en `src/main/index.ts`. La API del renderer está en
`src/shared/types.ts` y se expone en `src/preload/index.ts`.

| Canal | Argumentos | Devuelve | Efecto |
|---|---|---|---|
| `sites:list` | — | `Site[]` | Lee configuración, rutas y certificados |
| `sites:secure` | `name`, `on` | `void` | Ejecuta `valet secure` o `valet unsecure` |
| `sites:open` | `name` | `void` | Calcula la URL y la abre con `shell.openExternal` |
| `sites:project-info` | — | `ProjectInfo` | Dominio, rutas aparcadas, carpeta por defecto, puerto HTTP y disponibilidad de Composer/Valet |
| `sites:pick-dir` | `current?` | `string \| null` | Abre el selector nativo de carpetas de Electron |
| `sites:create` | `CreateProjectOptions` | `Site` | Ejecuta Composer, registra el sitio y emite eventos de creación |
| `sites:create-event` | — | — | Evento main → renderer: etapa o registro de Composer |
| `php:list` | — | `PhpInfo` | Detecta versiones y versión actual |
| `php:use` | `version` | `void` | Ejecuta `valet use php@X.Y` |
| `ports:scan` | — | `PortsInfo` | Lee nginx, Apache y `ss` |
| `ports:set` | `http`, `https` | `void` | Reescribe nginx, valida, recarga y guarda |
| `ports:setApache` | `http`, `https` | `void` | Reescribe Apache, valida, recarga y guarda |
| `services:list` | — | `Service[]` | Filtra unidades y consulta estado |
| `services:action` | `name`, `action` | `void` | `pkexec systemctl <acción>` |
| `install:check` | — | `Env` | Diagnóstico completo |
| `install:start` | `InstallOptions` | `void` | Flujo de instalación; emite eventos |
| `install:uninstall` | `pkg` | `void` | Flujo de desinstalación; emite eventos |
| `install:repairDns` | `mode` | `void` | Aplica DNS Seguro o Hosts |
| `install:syncHosts` | — | `void` | Atajo de `repairDns('hosts')` |
| `install:event` | — | — | Evento main → renderer: plan, paso o registro |
| `mailpit:info` | — | `MailpitInfo` | Estado, versión, endpoints, métricas y avisos |
| `mailpit:config` | — | `MailpitConfig` | Lee `mailpit.json` |
| `mailpit:save` | `MailpitConfig` | `MailpitInfo` | Valida, escribe env/unidad y reinicia con rollback |
| `mailpit:start` / `stop` / `restart` | — | `MailpitInfo` | Controla la unidad de usuario |
| `mailpit:install` | — | `MailpitInfo` | Descarga, verifica e instala; emite eventos |
| `mailpit:useSystem` | `path` | `MailpitInfo` | Cambia al binario del sistema |
| `mailpit:uninstall` | `deleteData` | `void` | Detiene, deshabilita y elimina unidad/binario |
| `mailpit:logs` | `lines?` | `string` | Archivo configurado o `journalctl --user` |
| `mailpit:clearMessages` | — | `void` | `DELETE /api/v1/messages` |
| `mailpit:sendTest` | `to` | `void` | `POST /api/v1/send` |
| `mailpit:openExternal` | — | `void` | Abre la UI en el navegador |
| `mailpit:auxiliary` / `writeAuxiliary` | `kind`, `content` | `MailpitAuxFile[]` | Lee o guarda Relay, Forward y Etiquetas |
| `mailpit:configureEnv` | `site` | `MailpitProjectEnvResult` | Escribe `MAIL_*` en el `.env` |
| `mailpit:sendmailInfo` | — | `MailpitSendmailInfo[]` | Estado de `sendmail_path` por versión |
| `mailpit:setPhpSendmail` | `version`, `enable` | `void` | Edita `php.ini` con `pkexec` y revierte |
| `mailpit:testPhpMail` | `version`, `to` | `void` | Envía con `mail()` y comprueba el contador |
| `mailpit:view` | `rect`, `visible`, `url?` | — | Mueve u oculta la `WebContentsView` |
| `mailpit:event` | — | — | Evento main → renderer: estado, progreso o registro |
| `mailpit:shortcut` | — | — | Atajo capturado dentro de Mailpit (`1`…`6`, `b`, `,`) |

No hay canales para leer o escribir archivos arbitrarios, ejecutar comandos genéricos ni
abrir una URL cualquiera. Los ajustes visuales no pasan por IPC: se guardan en
`localStorage`.

## Flujos

### Arranque

1. `main/index.ts` asigna el nombre, carga el icono y registra los handlers.
2. Cuando Electron está listo, elimina el menú y crea la ventana.
3. El preload expone `window.api`.
4. `renderer/main.tsx` aplica los ajustes guardados antes del primer render.
5. `App` arranca en **Sitios**; Sitios, PHP y el estado de Mailpit se cargan al inicio.
6. Puertos, Servicios e Instalación se cargan al entrar en su pestaña.
7. La página de Instalación se monta una vez y se oculta con `hidden`; así conserva el
   progreso y el registro al cambiar de sección.

### Listar sitios

```text
Renderer → sites:list
  → valet.ts lee ~/.valet/config.json
  → recorre rutas parked y ~/.valet/Sites
  → comprueba Certificates/<nombre>.<dominio>.crt
  → lee los puertos reales de nginx
  → calcula url con http/https y puerto
  → devuelve Site[] ordenado
```

### Crear un proyecto Laravel

```text
Renderer → sites:project-info
  → lee dominio y rutas aparcadas
  → detecta puerto HTTP, Valet, instalador de Laravel y capacidades (PDO, gestores Node)
  → devuelve ProjectInfo

Renderer → sites:pick-dir (opcional)
  → dialog.showOpenDialog con openDirectory/createDirectory
  → devuelve ruta o null

Renderer → sites:create({ parentDir, answers, database })
  → valida nombre, carpeta, respuestas, flags disponibles y credenciales
  → si falta el instalador: composer global require laravel/installer
      con COMPOSER_HOME aislado
  → spawn laravel new <name> [flags]
      cwd=parentDir, detached=true (grupo de procesos), sin variables de agente
      credenciales DB_* en el entorno, nunca en los argumentos
  → emite log con stdout/stderr y stage con cada fase
  → parchea .env con DB_* y APP_URL; .env.example solo con valores no secretos
  → si parentDir no es una ruta aparcada: valet link <name> con cwd=<target>
  → listSites y busca el sitio nuevo
  → emit stage: proyecto creado
  → devuelve Site
  → renderer refresca la lista y selecciona el sitio

Renderer → sites:cancel-create
  → SIGTERM al grupo del instalador; SIGKILL a los 5 s

Renderer → sites:delete-incomplete(path)
  → solo la última carpeta registrada por una creación fallida
  → rechaza ~/.valet/Sites y sitios ya registrados
```

Si `sites:create` falla, el renderer muestra el mensaje y emite `incomplete` con la ruta
para ofrecer su borrado. La cancelación mata Composer, PHP y el gestor de Node.

### Guardar puertos de nginx

```text
Renderer → ports:set(http, https)
  → valida rango, reservados e igualdad
  → detecta puertos actuales en los listen
  → comprueba que los nuevos estén libres
  → copia cada archivo a backups/<fecha>/nginx
  → sustituye listen
  → pkexec nginx -t
  → systemctl reload/start nginx
  → si falla: restaura copias y recarga la configuración anterior
  → guarda ~/.valet-dashboard/config.json
```

### Instalar

```text
Renderer → install:start(opciones)
  → install.ts valida paquete, carpeta y modo DNS
  → emite plan de pasos
  → por cada paso: run → ok/skip/fail + log
  → backup, Apache, paquetes, helpers, Composer, parche DNS,
    valet install, park, DNS, verificación
  → install:event llega al renderer y actualiza progreso/registro
```

### Correo y vista embebida

```text
Renderer → mailpit:info
  → main lee mailpit.json, resuelve el binario y consulta systemctl --user
  → si está activo, consulta /api/v1/info (versión, mensajes, tamaño, uptime)
  → devuelve MailpitInfo

Renderer → mailpit:view({x, y, width, height}, visible, url)
  → main crea o reutiliza una WebContentsView con partición persist:mailpit
  → carga la UI de Mailpit y la muestra solo en ese rectángulo
  → login/certificate-error resuelven auth y el certificado autofirmado

Renderer → mailpit:save(config)
  → valida opciones, puertos y TLS
  → escribe mailpit.json, mailpit.env y la unidad
  → systemctl --user daemon-reload + restart
  → espera /livez; si falla, restaura configuración, env y binario
```

## Decisiones de diseño

- **Composer aislado**: evita conflictos con el Composer global (por ejemplo, Illuminate
  13) y no modifica las dependencias del usuario.
- **DNS seguro propio**: en lugar del DNS clásico de Valet, usa dnsmasq en
  `127.0.0.1:5354` y una ruta en systemd-resolved, sin tocar NetworkManager.
- **Detección real de puertos**: no se confía solo en el último valor guardado; se leen las
  directivas `listen` de nginx.
- **Copias antes de escribir**: cada cambio de configuración relevante tiene una copia y
  una validación previa.
- **Reversión**: los cambios de puertos se restauran si la validación o la recarga fallan.
- **Sin shell**: todos los comandos usan arrays de argumentos.
- **Mailpit como servicio de usuario**: no depende de Valet ni del panel; se controla con
  `systemctl --user` y se embebe con `WebContentsView` en lugar de `<webview>` o `iframe`.
- **Descarga verificada**: el binario de Mailpit se compara con el `digest` SHA-256 que
  publica GitHub antes de reemplazar el anterior.
- **Listas permitidas**: servicios, acciones, modos DNS y formatos se validan en main.
- **Carpeta aparcada exacta**: solo si el destino es la raíz de una ruta `parked` el
  proyecto aparece solo; en cualquier otro caso se ejecuta `valet link`.
- **Creación sin cancelación**: Composer se ejecuta hasta terminar y el diálogo muestra el
  registro en vivo; no se mata el proceso a mitad.
- **Nombre y versión validados en main**: el renderer no puede pasar opciones arbitrarias a
  Composer ni rutas fuera de la carpeta elegida.
- **URL calculada en main**: el renderer no puede pedir que se abra una URL arbitraria.
- **Carga diferida**: Puertos, Servicios e Instalación no se consultan hasta que se
  necesitan.
- **Sin router**: la sección activa es un estado de React; no hay URLs internas.
- **Ajustes locales**: no hay backend de preferencias ni sincronización.

## Cómo añadir una función

1. Define el tipo y el método en `src/shared/types.ts`.
2. Impleméntalo en `src/main/valet.ts` o `src/main/install.ts`.
3. Regístralo en `src/main/index.ts` con `ipcMain.handle`.
4. Expónlo en `src/preload/index.ts`.
5. Consúmelo desde `App.tsx` o el componente correspondiente.
6. Valida todas las entradas en el proceso principal.
7. Muestra errores en español y recarga los recursos afectados.
8. Ejecuta `npm run typecheck` y `npm run build`.

Buenas prácticas del proyecto:

- No pasar cadenas a un shell.
- No confiar en datos del renderer.
- No ejecutar Valet como root.
- Guardar copia antes de modificar configuración del sistema.
- Mantener la interfaz en español.
- Usar las variables CSS y las paletas existentes.
- No introducir dependencias nuevas sin necesidad.

## Limitaciones de la arquitectura

- No hay tests automatizados de la interfaz ni lint configurado; la verificación es `tsc`,
  el build y `go test ./...` para el CLI `devenv`.
- No hay registro persistente ni telemetría.
- No hay actualización automática.
- El proceso principal concentra toda la lógica del sistema; no hay un servicio separado.
- La interfaz no tiene enrutador ni estado global más allá de React y `localStorage`.
- La app es Linux-only en la práctica: usa systemd, polkit, `ss`, nginx, Apache y rutas de
  Debian.

## Relacionado

- [Desarrollo y empaquetado](Desarrollo)
- [Seguridad y copias](Seguridad-y-copias)
- [Interfaz](Interfaz)
