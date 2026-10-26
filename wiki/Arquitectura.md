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
│   ├── install.ts     Diagnóstico, instalación, DNS, backups y desinstalación
│   ├── exec.ts        execFile, rutas de la app y helper de pkexec
│   └── helpers.ts     askpass, envoltorio de sudo y entorno de Valet
├── preload/
│   └── index.ts       contextBridge → window.api
├── shared/
│   └── types.ts       Contrato IPC y tipos de datos
└── renderer/
    ├── main.tsx       Punto de entrada; aplica ajustes antes de renderizar
    ├── App.tsx        Shell, páginas, paneles y barra de estado
    ├── CreateProjectDialog.tsx
    ├── SettingsDialog.tsx
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
- **Proyectos Laravel**: valida nombre, carpeta y versión; comprueba Composer y Valet;
  ejecuta `composer create-project` con `spawn`, `cwd` y el `COMPOSER_HOME` aislado; emite
  el registro en vivo; detecta si la carpeta es una ruta aparcada y, si no, ejecuta
  `valet link`; devuelve el `Site` creado.
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
instalación se suscribe a `install:event`, y para los de creación de proyectos a
`sites:create-event`; en ambos casos devuelve una función para desuscribirse.

### `src/shared/types.ts`

Es el contrato único entre main, preload y renderer. Incluye `Api`, `Site`, `ProjectInfo`,
`CreateProjectOptions`, `CreateProjectEvent`, `PortsInfo`, `PhpInfo`, `Service`, `Env`,
`InstallOptions` e `InstallEvent`.

### `src/renderer`

- `App.tsx` contiene el shell y las cinco páginas: Sitios, PHP, Puertos, Servicios e
  Instalación, además de los paneles laterales y la barra de estado.
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

No hay canales para leer o escribir archivos arbitrarios, ejecutar comandos genéricos ni
abrir una URL cualquiera. Los ajustes visuales no pasan por IPC: se guardan en
`localStorage`.

## Flujos

### Arranque

1. `main/index.ts` asigna el nombre, carga el icono y registra los handlers.
2. Cuando Electron está listo, elimina el menú y crea la ventana.
3. El preload expone `window.api`.
4. `renderer/main.tsx` aplica los ajustes guardados antes del primer render.
5. `App` arranca en **Sitios**; Sitios y PHP se cargan al inicio.
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
  → detecta puerto HTTP y disponibilidad de Composer/Valet
  → devuelve ProjectInfo

Renderer → sites:pick-dir (opcional)
  → dialog.showOpenDialog con openDirectory/createDirectory
  → devuelve ruta o null

Renderer → sites:create({ name, parentDir, version })
  → valida nombre, versión, carpeta, requisitos y duplicados
  → emit stage: creando con Composer
  → spawn composer create-project laravel/laravel <name> [version]
      con cwd=parentDir y COMPOSER_HOME aislado
  → emite log con stdout/stderr
  → si parentDir no es una ruta aparcada: valet link <name> con cwd=<target>
  → listSites y busca el sitio nuevo
  → emit stage: proyecto creado
  → devuelve Site
  → renderer refresca la lista y selecciona el sitio
```

Si `sites:create` falla, el renderer muestra el mensaje en el diálogo y conserva el
registro. No hay cancelación del proceso de Composer en esta versión.

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

- No hay tests automatizados ni lint configurado; la verificación es `tsc` y el build.
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
