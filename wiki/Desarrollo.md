# Desarrollo y empaquetado

Esta página describe cómo desarrollar, verificar y empaquetar Valet Dashboard.

## Requisitos

- **Node.js 20 o superior** y npm.
- Linux para ejecutar y empaquetar la aplicación.
- Las herramientas del sistema que usa la app: `systemd`, `polkit`, `nginx`, PHP, etc. Para
  desarrollar la interfaz no necesitas Valet instalado, pero las páginas del sistema
  mostrarán estados vacíos o errores.
- Para generar `.deb` y `.rpm`, las herramientas de empaquetado habituales de la
  distribución.

La versión documentada es `0.1.0`.

## Instalación de dependencias

```bash
npm install
```

Instala Electron, React, TypeScript, Vite, electron-vite y electron-builder como
dependencias de desarrollo. No hay dependencias de ejecución separadas: React y el código
se empaquetan en el renderer.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca Electron en modo desarrollo con recarga |
| `npm run typecheck` | Ejecuta `tsc --noEmit` con `strict: true` |
| `npm run build` | Compila main, preload y renderer en `out/` |
| `npm run dist` | Compila y genera AppImage, `.deb` y `.rpm` en `dist/` |

No hay script de tests ni de lint. La verificación automática disponible es el chequeo de
tipos y la compilación.

## Desarrollo

```bash
npm run dev
```

`electron-vite` compila el proceso principal y el preload, levanta el servidor del renderer
y abre Electron. En desarrollo:

- El renderer se sirve desde Vite y admite recarga en caliente.
- El proceso principal usa `ELECTRON_RENDERER_URL` para cargar esa URL.
- Los cambios en main o preload requieren reiniciar la app si electron-vite no lo hace
  automáticamente.
- Los mensajes del proceso principal aparecen en la terminal donde ejecutaste el comando.
- Para depurar el renderer, añade temporalmente `win.webContents.openDevTools()` en
  `src/main/index.ts` o usa las herramientas de desarrollo de Chromium si tu entorno las
  habilita.

No ejecutes la app como root. Si necesitas permisos, la propia app pedirá autenticación con
polkit.

### Ejecutar una compilación sin empaquetar

```bash
npm run build
npx electron .
```

El campo `main` de `package.json` apunta a `out/main/index.js`, así que Electron carga la
compilación de `out/`.

## Verificación

Antes de dar por buena una cambio:

```bash
npm run typecheck
npm run build
```

`typecheck` usa el `tsconfig.json` del proyecto:

- `target: ES2022`
- `module: ESNext`
- `moduleResolution: Bundler`
- `jsx: react-jsx`
- `strict: true`
- `noEmit: true`
- Incluye `src` y `electron.vite.config.ts`

El build debe terminar sin errores. No hay una suite de tests que ejecutar.

### Comprobación manual

No hay tests automatizados, así que conviene revisar a mano las áreas afectadas:

- **Sitios**: lista, búsqueda, HTTPS, botón **Abrir**, estados vacíos y error.
- **PHP**: detección de versiones, versión actual y cambio.
- **Puertos**: valores detectados, presets, validaciones, guardado, reversión y conflictos.
- **Servicios**: lista filtrada, estados, inicio, parada, reinicio y errores de polkit.
- **Instalación**: diagnóstico, advertencias, opciones, progreso, registro, reparar DNS,
  sincronizar hosts y desinstalar.
- **Ajustes**: tema, paleta, iconos, fuente, tamaño, vista compacta, reinicio y
  persistencia.
- **Interfaz**: atajos, panel lateral, redimensionado, pantallas pequeñas y barra de estado.
- **Consola**: sin errores de React ni de IPC.

Para probar la app en un sistema limpio, usa una máquina virtual o un contenedor con
systemd y polkit. Un contenedor sin systemd no sirve para las páginas de Servicios,
Puertos e Instalación.

## Estructura y convenciones

```text
src/main       Lógica del sistema y ventana
src/preload    Puente tipado
src/shared     Contrato IPC
src/renderer   Interfaz React
resources      Icono de la ventana
build/icons    Iconos del paquete (16 a 1024 px)
wiki           Esta documentación
```

Convenciones observadas en el código:

- TypeScript estricto; el contrato IPC está tipado en `src/shared/types.ts`.
- Componentes funcionales y hooks.
- Comillas simples y sin punto y coma.
- Nombres de la interfaz y mensajes de error en español.
- Estilos mediante variables CSS y clases existentes.
- Comandos con `execFile`/`spawn` y arrays de argumentos, nunca con shell.
- Validación de datos en el proceso principal.
- Copia de seguridad antes de modificar configuración del sistema.

Para añadir una función, consulta la sección «Cómo añadir una función» de
[Arquitectura](Arquitectura).

## Empaquetado

```bash
npm run dist
```

El script ejecuta primero el build y luego:

```bash
electron-builder --linux AppImage deb rpm
```

Los artefactos quedan en `dist/`:

| Formato | Uso | Nombre habitual |
|---|---|---|
| **AppImage** | Portable, sin instalar | `Valet Dashboard-0.1.0.AppImage` |
| **.deb** | Debian, Ubuntu y derivados | `valet-dashboard_0.1.0_amd64.deb` |
| **.rpm** | Fedora, RHEL, CentOS y derivados | `valet-dashboard-0.1.0.x86_64.rpm` |

Los nombres exactos pueden variar según la arquitectura y la versión de electron-builder.

### Configuración de electron-builder

Está en la clave `build` de `package.json`:

| Clave | Valor |
|---|---|
| `appId` | `dev.valet.dashboard` |
| `productName` | `Valet Dashboard` |
| `files` | `out/**` |
| `extraResources` | `resources/icon.png` → `icon.png` dentro de `resources/` del paquete |
| `linux.category` | `Development` |
| `linux.icon` | `build/icons` |
| `linux.target` | `AppImage`, `deb`, `rpm` |
| `desktop.Name` | `Valet Dashboard` |
| `desktop.Comment` | `Panel de escritorio para Valet Linux` |
| `desktop.Categories` | `Development;` |
| `desktop.StartupWMClass` | `Valet Dashboard` |

La app no tiene configuración de publicación ni actualización automática. Los paquetes se
generan localmente.

### Instalar los artefactos

```bash
chmod +x "dist/Valet Dashboard-0.1.0.AppImage"
./"dist/Valet Dashboard-0.1.0.AppImage"
```

```bash
sudo apt install ./dist/valet-dashboard_0.1.0_amd64.deb
```

```bash
sudo dnf install ./dist/valet-dashboard-0.1.0.x86_64.rpm
```

### AppImage y FUSE

Si el AppImage no arranca porque falta FUSE:

```bash
sudo apt install libfuse2
```

O ejecútalo sin montar:

```bash
./"dist/Valet Dashboard-0.1.0.AppImage" --appimage-extract-and-run
```

## Cambiar la versión

1. Actualiza `version` en `package.json`.
2. Ejecuta `npm run typecheck` y `npm run build`.
3. Ejecuta `npm run dist`.
4. Prueba los tres artefactos en un sistema limpio.
5. Actualiza esta wiki y el `README.md` si cambió el comportamiento.

No hay un archivo `CHANGELOG.md` en el repositorio; si se añade, conviene registrar los
cambios de usuario y los cambios de comportamiento del instalador.

## Problemas de desarrollo y empaquetado

| Problema | Causa probable | Solución |
|---|---|---|
| Electron no descarga | Proxy, firewall o red | Configura el proxy de npm/Electron y reintenta `npm install` |
| `The SUID sandbox helper binary was found, but is not configured correctly` | Permisos de `chrome-sandbox` en Electron | Corrige los permisos del binario o reinstala la dependencia; evita `--no-sandbox` como solución permanente |
| El AppImage no arranca | Falta FUSE | Instala `libfuse2` o usa `--appimage-extract-and-run` |
| Falla el target `.rpm` | Faltan herramientas de empaquetado | Instala `rpm`/`rpmbuild` y las dependencias de electron-builder |
| Falla el target `.deb` | Faltan `dpkg`, `fakeroot` o espacio | Instala las herramientas y revisa el espacio en `dist/` |
| La ventana queda en blanco en producción | `out/` incompleto o ruta de preload incorrecta | Ejecuta `npm run build` y revisa `out/main`, `out/preload` y `out/renderer` |
| La ventana queda en blanco en desarrollo | El servidor de Vite no arrancó | Revisa la terminal y vuelve a ejecutar `npm run dev` |
| Cambios de main no se reflejan | El proceso principal no se recargó | Reinicia `npm run dev` |
| Los ajustes no se guardan | `localStorage` no disponible o datos corruptos | Revisa el directorio de datos de Electron y prueba **Restablecer** |
| Error de tipos en un canal IPC | El contrato de `src/shared/types.ts` no coincide | Actualiza main, preload y renderer a la vez |

## Limitaciones del entorno de desarrollo

- No hay CI, tests, lint ni comprobación de formato.
- No hay actualización automática ni firma de paquetes.
- El empaquetado está orientado a Linux.
- Algunas funciones requieren systemd, polkit y un escritorio real; no se pueden probar en
  un contenedor mínimo.
- La app no incluye un visor de registros; para depurar usa la terminal y
  `journalctl`.

## Relacionado

- [Arquitectura](Arquitectura)
- [Instalación](Instalacion)
- [Seguridad y copias](Seguridad-y-copias)
- [Solución de problemas](Solucion-de-problemas)
