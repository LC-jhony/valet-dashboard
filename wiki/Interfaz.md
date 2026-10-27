# Interfaz

La aplicación usa un diseño de escritorio inspirado en un editor de código: barra de
actividad, panel lateral contextual, área de trabajo y barra de estado.

```text
┌────┬──────────────────┬─────────────────────────────────────────────┐
│    │  Panel lateral   │  Área de trabajo                            │
│ R  │  contextual      │  ┌───────────────────────────────────────┐  │
│ A  │                  │  │ Título · descripción · Actualizar     │  │
│ I  │  Búsqueda        │  ├───────────────────────────────────────┤  │
│ L  │  Listas          │  │ Avisos de error                       │  │
│    │  Tarjetas        │  │ Listas, tarjetas, formularios         │  │
│    │  Diagnóstico     │  │ Botones de acción                     │  │
│    │                  │  └───────────────────────────────────────┘  │
├────┴──────────────────┴─────────────────────────────────────────────┤
│ Barra de estado: PHP · nginx · puertos · sitios · servicios · tema   │
└──────────────────────────────────────────────────────────────────────┘
```

## Barra de actividad

Está a la izquierda y contiene:

- El logotipo del panel: al pulsarlo vuelve a **Sitios**.
- **Sitios**, **PHP**, **Puertos**, **Servicios**, **Instalación** y **Correo**.
- **Ajustes**, al pie.

Cada botón muestra su nombre y su atajo (`Ctrl+1`…`Ctrl+6`, `Ctrl+,`) al pasar el ratón.
La sección activa queda resaltada con el color de acento.

Al hacer clic en la sección que ya está activa, el panel lateral se oculta o se muestra.

## Panel lateral

Es contextual: su contenido cambia según la sección.

| Sección | Contenido del panel |
|---|---|
| **Sitios** | Buscador por nombre o ruta, lista de sitios con icono, ruta, candado si tiene HTTPS y resumen de sitios/HTTPS |
| **PHP** | Versión en uso y lista de versiones instaladas, con etiqueta «en uso» |
| **Puertos** | Tarjetas de Valet/nginx, Apache y uso de puertos; al pulsarlas se desplaza la página a esa sección |
| **Servicios** | Lista de servicios con estado activo/detenido y resumen |
| **Instalación** | Sistema, gestor de paquetes, herramientas, red/DNS, conflictos y advertencias |
| **Correo** | Estado de Mailpit, endpoints UI/SMTP/POP3, mensajes, tamaño de la base y avisos |

### Acciones del panel

- **Actualizar**: vuelve a cargar los datos de la sección.
- **Ocultar panel**: lo cierra. También se puede usar `Ctrl+B`.
- **Redimensionar**: arrastra el borde derecho. El ancho va de 220 a 420 px y se recuerda
  en `localStorage` bajo `valet-dashboard:sidebar-width`.
- **Seleccionar un elemento**: en Sitios, PHP y Servicios, al hacer clic en un elemento del
  panel se resalta y se desplaza hasta él en el área principal.
- **Pantallas pequeñas**: por debajo de 900 px el panel se convierte en una capa
  superpuesta. Se cierra con `Esc`, con el fondo oscuro o al elegir un elemento.

## Área de trabajo

Cada página tiene:

- **Encabezado**: título, descripción, acciones de la página (por ejemplo, **Nuevo
  proyecto** en Sitios) y botón **Actualizar**.
- **Aviso de error**: si falla una carga o una acción, aparece un bloque con el mensaje.
- **Contenido**: listas, tarjetas, formularios y botones.
- **Estados de carga**: esqueletos mientras se consultan datos.
- **Estados vacíos**: explican qué falta y cómo continuar.
- **Confirmaciones**: algunas acciones peligrosas piden confirmación en un diálogo del
  sistema (por ejemplo, el modo DNS Clásico o desinstalar).
- **Diálogos**: **Ajustes** y **Nuevo proyecto** se abren sobre la página. Se cierran con
  `Esc` o con el fondo, salvo que haya una operación en curso.

Los botones de acción de cada fila se deshabilitan mientras hay una operación en curso.
Los botones con borde de acento son las acciones principales.

## Barra de estado

Muestra, de izquierda a derecha:

- **Valet** y la sección actual.
- **PHP**: versión actual detectada.
- **nginx**: punto verde si está activo, gris si está detenido.
- **Puertos**: HTTP/HTTPS configurados, cuando se han cargado.
- **Sitios**: número total, cuando se han cargado.
- **Servicios**: activos/total, cuando se han cargado.
- **Mailpit**: punto verde y puerto de la UI si está capturando correo; gris si está detenido.
- **Tema**: botón sol/luna para cambiar entre claro y oscuro.

Los datos de Puertos y Servicios aparecen después de visitar esas secciones, porque se
cargan bajo demanda. Sitios y PHP se cargan al iniciar.

## Navegación y atajos

| Atajo | Acción |
|---|---|
| `Ctrl+B` | Mostrar u ocultar el panel lateral |
| `Ctrl+,` | Abrir Ajustes |
| `Ctrl+1` | Sitios |
| `Ctrl+2` | PHP |
| `Ctrl+3` | Puertos |
| `Ctrl+4` | Servicios |
| `Ctrl+5` | Instalación |
| `Ctrl+6` | Correo |
| `Esc` | Cerrar Ajustes; en pantallas pequeñas, cerrar el panel |

También funciona `Cmd` en macOS. Los atajos se ignoran mientras el diálogo de Ajustes o de
Nuevo proyecto está abierto, salvo `Esc`.

## Comportamiento de las páginas

- **Sitios**: búsqueda compartida entre el panel y la lista principal; el filtro se aplica
  a nombre y ruta. **Nuevo proyecto** abre el diálogo de creación con registro de Composer;
  al terminar, el sitio nuevo queda seleccionado.
- **Puertos**: los campos se sincronizan con los puertos detectados al recargar. Al pulsar
  una tarjeta del panel se hace scroll suave a nginx, Apache o uso de puertos.
- **Servicios**: las acciones recargan servicios y puertos para mantener la barra de
  estado y la lista de conflictos al día.
- **Instalación**: la página permanece montada aunque cambies de sección. Así el progreso
  y el registro no se pierden mientras la instalación está en curso. Aun así, no cierres
  la aplicación durante una operación.
- **Correo**: la interfaz de Mailpit se muestra en una vista embebida que ocupa el área
  principal. La vista se oculta al abrir **Configuración**, **Integraciones** o cambiar de
  sección, y se vuelve a alinear al redimensionar la ventana o el panel lateral.

## Ventana

- Tamaño inicial: 1100 × 720.
- Tamaño mínimo: 760 × 520.
- Sin menú de aplicación (se elimina al arrancar).
- Icono propio en la ventana y en el lanzador del escritorio.
- Tema visual sincronizado con el sistema si se elige **Sistema** en Ajustes.

## Accesibilidad

La interfaz incluye etiquetas `aria-label`, roles de diálogo y lista, foco visible y
cierres con teclado. Los iconos decorativos se marcan como ocultos para lectores de
pantalla. Las confirmaciones destructivas usan el diálogo nativo del sistema.

## Relacionado

- [Ajustes](Ajustes)
- [Sitios](Sitios)
- [Correo](Correo)
- [Instalación](Instalacion)
