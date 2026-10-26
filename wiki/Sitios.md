# Sitios

La pestaña **Sitios** muestra los proyectos que Valet está sirviendo. Un sitio puede ser:

- **Parked (aparcado)**: un subdirectorio de una carpeta registrada con `valet park`.
- **Linked (enlazado)**: un directorio registrado con `valet link`, normalmente fuera de
  las carpetas aparcadas.

El panel no crea ni elimina sitios: solo los lista y gestiona su HTTPS y su apertura en el
navegador.

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

## Activar o quitar HTTPS

El botón de HTTPS ejecuta el comando correspondiente de Valet:

- **Activar HTTPS** → `valet secure <sitio>`.
- **Quitar HTTPS** → `valet unsecure <sitio>`.

Puede pedir la contraseña de administrador mediante el diálogo del sistema. Al terminar,
la lista se recarga y el certificado se refleja en la etiqueta y en el botón.

> **Importante:** `valet secure` y `valet unsecure` pueden regenerar la configuración de
> nginx del sitio. Si usas puertos personalizados, vuelve a guardarlos en
> [Puertos](Puertos) después de cambiar el HTTPS.

## Añadir y quitar sitios

La interfaz no tiene botones para crear, enlazar o eliminar sitios. Usa la terminal:

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
| **Aún no hay sitios** | No se encontraron carpetas aparcadas ni enlaces. Instala Valet y registra proyectos |
| **Sin coincidencias** | La búsqueda no coincide con ningún nombre o ruta |
| **No hay sitios todavía** (panel) | No hay datos que mostrar; usa `valet park` o `valet link` |
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

## Limitaciones

- No crea ni elimina sitios, enlaces o rutas aparcadas.
- No gestiona sitios proxy de Valet.
- No configura `valet share` ni túneles.
- No permite elegir una versión de PHP por sitio.
- No edita el dominio/TLD de Valet.
- No muestra logs de nginx ni de la aplicación.
- No gestiona directamente el almacén de confianza del navegador: `valet secure` puede
  instalar el certificado con `certutil` si está disponible, pero el panel no lo garantiza.
