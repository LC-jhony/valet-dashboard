# Sitios

La pestaña **Sitios** muestra los proyectos que Valet está sirviendo. Un sitio puede ser:

- **Parked (aparcado)**: un subdirectorio de una carpeta registrada con `valet park`.
- **Linked (enlazado)**: un directorio registrado con `valet link`, normalmente fuera de
  las carpetas aparcadas.

El panel lista los sitios, crea proyectos Laravel nuevos, gestiona su HTTPS y los abre en
el navegador. No elimina sitios ni registra carpetas existentes.

## Cómo se construye la lista

- El dominio se lee de `~/.valet/config.json`, en la clave `domain` (por defecto `test`).
  El panel admite también la clave antigua `tld`.
- Las carpetas *parked* se leen de las rutas registradas en ese mismo archivo.
- Los sitios *linked* se leen de `~/.valet/Sites`.
- Si un nombre existe como *parked* y como *linked*, gana el *linked*.
- Solo se muestran directorios; los enlaces rotos se ignoran.
- La lista se ordena alfabéticamente por nombre.
- Un sitio se considera **seguro** si existe el certificado
  `~/.valet/Certificates/<nombre>.<dominio>.crt`.

Cada sitio incluye una URL calculada con:

- `https` si tiene certificado; `http` si no.
- El puerto real de nginx si no es 80/443.
- El dominio de Valet.

Ejemplos:

| Sitio | HTTPS | Puertos nginx | URL |
|---|---|---|---|
| `mi-proyecto` | No | 80 / 443 | `http://mi-proyecto.test/` |
| `mi-proyecto` | Sí | 80 / 443 | `https://mi-proyecto.test/` |
| `mi-proyecto` | No | 8080 / 8443 | `http://mi-proyecto.test:8080/` |
| `mi-proyecto` | Sí | 8080 / 8443 | `https://mi-proyecto.test:8443/` |

## Panel lateral

- **Buscador**: filtra por nombre o ruta. No distingue mayúsculas y minúsculas.
- **Lista**: icono de carpeta aparcada o enlazada, nombre, ruta y candado si tiene HTTPS.
- **Resumen**: total de sitios y cuántos tienen HTTPS.
- Al hacer clic en un sitio, se resalta y se desplaza hasta su fila en el área principal.
- En pantallas pequeñas, al elegir un sitio se cierra el panel lateral.

## Lista principal

Cada fila muestra:

- Icono según el tipo.
- Nombre del sitio.
- Ruta real del proyecto.
- Etiqueta `parked` o `linked`.
- Etiqueta **HTTPS** si el certificado existe.
- Botones **Abrir** y **Activar HTTPS** / **Quitar HTTPS**.

La barra superior de la lista indica cuántos sitios hay (o cuántos coinciden con la
búsqueda) y cuántos tienen HTTPS.

## Abrir un sitio en el navegador

El botón **Abrir** abre la URL del sitio en el navegador predeterminado del sistema.

- Usa el navegador del escritorio a través de Electron.
- Respeta HTTPS y los puertos personalizados de nginx.
- El título del botón muestra la URL completa que se abrirá.
- Si el nombre del sitio no se puede convertir en una URL válida (por ejemplo, contiene
  espacios o un `@` que el parser interpretaría como usuario), el botón queda deshabilitado.
- No inicia nginx ni comprueba que el sitio responda. Si nginx está detenido o el DNS no
  resuelve, el navegador mostrará el error de conexión.
- Si el sitio tiene HTTPS pero el certificado de Valet no es de confianza en el navegador,
  puede aparecer una advertencia de certificado.

> El botón solo abre la URL. No crea el sitio, no activa HTTPS y no sincroniza hosts.

## Crear un proyecto Laravel

El botón **Nuevo proyecto** del encabezado de Sitios abre un asistente que crea un
proyecto con el instalador oficial (`laravel new`), lo registra en Valet y lo selecciona
en la lista.

### Requisitos

- **Valet** instalado. Si falta, el diálogo lo indica y desactiva **Crear proyecto**.
- **Instalador de Laravel** (`laravel/installer`). Si no está, el panel lo instala con
  Composer en el `COMPOSER_HOME` aislado (`~/.config/valet-dashboard/composer`) la primera
  vez que creas un proyecto. No modifica el Composer global.
- **Composer** solo si hace falta instalar el instalador. Si ya hay un `laravel` global o
  aislado, no se usa Composer.
- Conexión a Internet para descargar Laravel y sus dependencias.
- Una carpeta existente con permisos de escritura.
- El motor de base de datos elegido, si no es SQLite, con la base ya creada y un usuario
  con permiso para migrar.

El asistente crea siempre la **última versión estable** de Laravel: el instalador no
admite una restricción de versión.

### Pasos del asistente

El formulario cambia según lo que respondas: las preguntas de Livewire solo aparecen con
ese starter kit, las credenciales solo con motores que no son SQLite, y los motores sin
extensión PDO aparecen deshabilitados.

#### 1. Proyecto

| Campo | Descripción |
|---|---|
| **Nombre del proyecto** | Minúsculas, números y guiones; máximo 63 caracteres; sin empezar ni terminar en guion. Será el nombre de la carpeta, del enlace y del sitio |
| **Carpeta de proyectos** | Carpeta donde se creará `<carpeta>/<nombre>`. Se puede escribir, elegir con el selector nativo o escoger una ruta aparcada. `~/.valet/Sites` está reservada para enlaces y no se ofrece como destino |

Debajo se muestran la URL prevista y el estado del instalador.

#### 2. Interfaz

- **¿Usar un starter kit?**
  - **Sí, con autenticación**: elige React, Svelte, Vue o Livewire y el proveedor de
    autenticación (Laravel o WorkOS). Con Livewire puedes usar componentes de archivo
    único o de clase; el soporte de equipos solo se ofrece con archivo único.
  - **No, solo el esqueleto**: elige Blade, React, Svelte, Vue o Livewire. El proyecto se
    crea sin autenticación; Blade deja el esqueleto clásico.
- WorkOS necesita credenciales propias después de crear el proyecto; el asistente no las
  pide.

#### 3. Herramientas

| Opción | Efecto |
|---|---|
| **Pruebas** | Instala **Pest** o **PHPUnit** |
| **Gestor de Node** | `npm`, `pnpm`, `bun` o `yarn` instalan dependencias y compilan assets. **Ninguno** omite ese paso y deja los assets sin compilar |
| **Laravel Boost** | Instala Boost para asistencia con IA |
| **Repositorio Git** | Ejecuta `git init` y crea el primer commit |

Solo se ofrecen los gestores de Node que existen en el equipo.

#### 4. Base de datos

Los motores disponibles se detectan con las extensiones `pdo_*` del PHP que usa el
instalador. En esta máquina, por ejemplo, hay `pdo_mysql` y `pdo_pgsql` pero no
`pdo_sqlite`, así que SQLite aparece deshabilitado.

| Motor | Extensión | Puerto por defecto |
|---|---|---|
| SQLite | `pdo_sqlite` | — |
| MySQL | `pdo_mysql` | 3306 |
| MariaDB | `pdo_mysql` | 3306 |
| PostgreSQL | `pdo_pgsql` | 5432 |
| SQL Server | `pdo_sqlsrv` | 1433 |

Con un motor distinto de SQLite se piden **host**, **puerto**, **base de datos**,
**usuario** y **contraseña**. El instalador ejecuta las migraciones: la base debe existir
y las credenciales deben funcionar.

Los secretos viajan por el **entorno del proceso**, nunca como argumentos ni en el
registro. Después de crear el proyecto se escriben en `.env`; en `.env.example` solo
quedan los valores no secretos. Así los argumentos no aparecen en `ps` y la contraseña no
queda en el historial visible.

El resumen muestra el comando exacto que se ejecutará, sin credenciales.

### Qué ocurre al crear

1. Se validan el nombre, la carpeta, las respuestas y que no exista la carpeta de destino
   ni un sitio con ese nombre.
2. Si falta el instalador, se instala en el Composer aislado.
3. Se ejecuta `laravel new <nombre>` con `--no-interaction --no-ansi` y una opción por
   cada respuesta (starter kit, autenticación, pruebas, Boost, Node, Git y base de datos).
4. El diálogo muestra el **registro en vivo** y el paso actual.
5. Si la carpeta elegida es **exactamente** una ruta aparcada, el proyecto aparece solo en
   la lista. Si no, se ejecuta `valet link <nombre>` dentro del proyecto.
6. Se ajusta `APP_URL` en `.env` con el dominio y el puerto reales de nginx.
7. La lista se actualiza y el sitio queda seleccionado. El resultado ofrece **Abrir sitio**
   y **Cerrar**.

El nombre se usa para la carpeta, el enlace de Valet y el dominio: `mi-app` →
`http://mi-app.test/` (o el dominio configurado en Valet).

### Cancelar y carpetas incompletas

**Detener** mata el grupo de procesos completo del instalador, incluidos Composer, PHP y
el gestor de Node. No espera a que termine el paso actual.

Si la creación falla después de crear la carpeta, el diálogo ofrece **Eliminar carpeta
incompleta**. El panel solo borra la última carpeta que creó esa ejecución y comprueba
antes que:

- no esté dentro de `~/.valet/Sites`;
- no sea ya un sitio registrado;
- el nombre de la carpeta siga el formato de proyecto.

Nunca borra una ruta arbitraria ni un proyecto que ya funcione. Si el proyecto se creó
pero falló el enlace, la carpeta se conserva y el mensaje indica la ruta.

> **Modo DNS Hosts:** después de crear un proyecto, pulsa **Sincronizar hosts** en
> [Instalación](Instalacion#modo-hosts) para que el dominio nuevo resuelva. El modo Seguro
> resuelve cualquier subdominio de `*.test` sin pasos adicionales.

### Errores habituales

| Mensaje | Causa | Solución |
|---|---|---|
| `Valet no está instalado` | No se encontró el binario de Valet | Instálalo desde **Instalación** |
| `No se encontró el instalador de Laravel ni Composer` | Faltan ambos binarios | Instala Composer desde **Instalación** |
| `No se pudo instalar el instalador de Laravel` | Fallo de red o de permisos en el Composer aislado | Revisa el registro del diálogo y la conexión |
| `Nombre de proyecto no válido` | Mayúsculas, espacios, guiones al inicio/fin o más de 63 caracteres | Usa minúsculas, números y guiones |
| `La carpeta de destino no existe` | La ruta escrita no existe | Elígela con **Elegir…** o créala antes |
| `La carpeta de destino no tiene permisos de escritura` | El usuario no puede escribir en la carpeta | Elige otra carpeta o corrige los permisos |
| `La carpeta ~/.valet/Sites está reservada...` | Se intentó crear dentro del directorio de enlaces de Valet | Elige una ruta aparcada o cualquier otra carpeta de proyectos |
| `Ya existe ...` | La carpeta de destino o el sitio ya existen | Cambia el nombre o la carpeta |
| `SQLite no está disponible...` | PHP no tiene `pdo_sqlite` | Instala la extensión o elige otro motor |
| `No se encontró <gestor> en el sistema` | El gestor de Node elegido no está en el `PATH` | Instálalo o elige otro |
| `Faltan las credenciales de la base de datos` | Se eligió un motor sin completar los datos | Completa host, puerto, base, usuario y contraseña |
| `El instalador de Laravel terminó con código X` | Fallo de red, de extensión PHP o de migración | Revisa el registro del diálogo y corrige la causa |
| `... no se pudo enlazar en Valet` | El proyecto se creó, pero `valet link` falló | Enlázalo a mano con `valet link <nombre>` en la carpeta del proyecto |
| `... no aparece en la lista de Valet` | El enlace no se creó o la ruta no es accesible | Pulsa **Actualizar** y revisa `valet links` |

Si el sitio se crea pero la página devuelve un error 500, revisa las extensiones de PHP
que necesita Laravel. Las migraciones y las sesiones suelen usar la base elegida; con
SQLite hace falta `pdo_sqlite`:

```bash
php -m | grep -i pdo
sudo apt install php-sqlite3
```

## Activar o quitar HTTPS

El botón de HTTPS ejecuta el comando correspondiente de Valet:

- **Activar HTTPS** → `valet secure <sitio>`.
- **Quitar HTTPS** → `valet unsecure <sitio>`.

Puede pedir la contraseña de administrador mediante el diálogo del sistema. Al terminar,
la lista se recarga y el certificado se refleja en la etiqueta y en el botón.

> **Importante:** `valet secure` y `valet unsecure` pueden regenerar la configuración de
> nginx del sitio. Si usas puertos personalizados, vuelve a guardarlos en
> [Puertos](Puertos) después de cambiar el HTTPS.

## Añadir y quitar sitios existentes

La interfaz crea proyectos Laravel nuevos, pero no registra carpetas que ya existen ni
elimina sitios. Para esas tareas usa la terminal:

### Aparcar una carpeta de proyectos

```bash
cd ~/Sites
valet park
```

Todos los subdirectorios de `~/Sites` pasarán a ser sitios. También puedes indicar una
ruta:

```bash
valet park /ruta/a/mis/proyectos
```

### Enlazar un proyecto concreto

```bash
cd /ruta/a/mi-proyecto
valet link
```

El nombre del enlace será el nombre de la carpeta. Para usar otro nombre:

```bash
valet link otro-nombre
```

### Quitar un enlace

```bash
valet unlink mi-proyecto
```

### Dejar de aparcar una ruta

```bash
valet forget /ruta/a/mis/proyectos
```

### Consultar lo registrado

```bash
valet paths
valet links
```

Después de cualquier cambio, pulsa **Actualizar** en la pestaña Sitios.

Si usas el modo DNS **Hosts**, además debes pulsar **Sincronizar hosts** en
[Instalación](Instalacion#modo-hosts) para que el nuevo nombre se añada a `/etc/hosts`.

## El dominio de Valet

El panel no edita el dominio ni el TLD de Valet. Lo lee de `~/.valet/config.json` y lo usa
para construir las URLs y localizar los certificados. Si cambias el dominio con las
herramientas de Valet, vuelve a cargar la pestaña para ver las URLs nuevas.

## Qué significa cada estado

| Estado | Significado |
|---|---|
| **Aún no hay sitios** | No se encontraron carpetas aparcadas ni enlaces. Crea un proyecto con **Nuevo proyecto** o registra uno con `valet park`/`valet link` |
| **Sin coincidencias** | La búsqueda no coincide con ningún nombre o ruta |
| **No hay sitios todavía** (panel) | No hay datos que mostrar; usa **Nuevo proyecto**, `valet park` o `valet link` |
| **Error de carga** | No se pudo leer la configuración de Valet o una ruta |

## Problemas habituales

- **El sitio no aparece**: comprueba que la carpeta está aparcada o enlazada, que es un
  directorio y que la ruta es accesible. Pulsa **Actualizar**.
- **El sitio aparece pero no abre**: comprueba que nginx está activo en
  [Servicios](Servicios), que el DNS resuelve y que usas el puerto correcto si es
  personalizado.
- **HTTPS muestra advertencia**: el navegador no confía en el certificado de Valet.
- **Un sitio nuevo no resuelve en modo Hosts**: pulsa **Sincronizar hosts**.
- **El botón Abrir está deshabilitado**: el nombre del sitio no es un nombre de host
  válido para el navegador.
- **Nuevo proyecto está deshabilitado**: falta Valet, no hay Composer para instalar el
  instalador de Laravel o las respuestas del asistente no son válidas. Revisa el aviso del
  diálogo.
- **El proyecto se creó pero el sitio no abre**: comprueba el DNS (en modo Hosts, pulsa
  **Sincronizar hosts**), que nginx esté activo y que PHP tenga las extensiones que necesita
  Laravel.
- **El instalador falla durante la creación**: revisa el registro en vivo; suele ser red,
  espacio en disco, permisos, una extensión PHP o credenciales de base de datos.

## Limitaciones

- No elimina sitios, enlaces ni rutas aparcadas. Solo crea proyectos Laravel nuevos.
- No registra carpetas existentes ni permite enlazarlas desde la interfaz.
- No crea ni configura la base de datos elegida: debe existir antes.
- No activa HTTPS automáticamente al crear el proyecto.
- No instala extensiones PHP ni bases de datos que el proyecto pueda necesitar.
- No gestiona sitios proxy de Valet.
- No configura `valet share` ni túneles.
- No permite elegir una versión de PHP por sitio.
- No edita el dominio/TLD de Valet.
- No muestra logs de nginx ni de la aplicación.
- No gestiona directamente el almacén de confianza del navegador: `valet secure` puede
  instalar el certificado con `certutil` si está disponible, pero el panel no lo garantiza.
