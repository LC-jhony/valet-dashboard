# Ajustes

El diálogo **Ajustes** cambia la apariencia del panel. No modifica Valet, nginx, PHP ni la
configuración del sistema: solo afecta a cómo se ve la aplicación.

## Abrir y cerrar

- Pulsa el engranaje al pie de la barra de actividad.
- O usa `Ctrl+,` (`Cmd+,` en macOS).
- Cierra con **Cerrar**, con `Esc` o haciendo clic en el fondo oscuro.
- Los cambios se aplican **al instante** y se guardan solos. No hay botón **Guardar** ni
  **Cancelar**.
- Mientras el diálogo está abierto, los atajos de navegación (`Ctrl+1`…`Ctrl+6`, `Ctrl+B`)
  no se procesan; `Esc` sigue cerrando el diálogo.

## Tema

| Opción | Comportamiento |
|---|---|
| **Sistema** | Sigue la preferencia clara/oscura del escritorio y reacciona si cambia mientras la app está abierta |
| **Claro** | Fuerza la variante clara |
| **Oscuro** | Fuerza la variante oscura |

El valor por defecto es **Sistema**. En la barra de estado hay un botón con sol o luna que
alterna entre claro y oscuro. Ese botón fija un tema explícito: si estabas en **Sistema**,
pasa a **Claro** u **Oscuro**, no vuelve a seguir al escritorio.

El tema también ajusta:

- El esquema de color nativo (`color-scheme`), para scrollbars y controles del sistema.
- Las sombras y el fondo de los diálogos.
- La variante clara u oscura de los iconos de archivos.

## Paleta

Hay dos paletas, inspiradas en temas de VS Code:

| Paleta | Rasgo visual |
|---|---|
| **Carbon** | Fondo oscuro neutro y acento rojo; variante clara sobre blanco |
| **Min** | Fondo oscuro más suave y acento azul; variante clara sobre blanco |

Cada opción muestra dos muestras de color: el fondo y el acento. La paleta cambia los
colores de fondo, paneles, texto, bordes, acento, avisos y estados. El valor por defecto es
**Carbon**.

La paleta y el tema son independientes: puedes usar Carbon en claro o Min en oscuro.

## Iconos de archivos

| Tema | Estilo |
|---|---|
| **Dawn** | Iconos coloridos, variante clara y oscura |
| **Deep** | Iconos de trazo más marcado |
| **Dim** | Iconos de tono apagado |
| **You** | Iconos con un estilo personalizado |

Se usan en las listas, los paneles laterales, las tarjetas de puertos y los estados. El
panel elige automáticamente la variante `-light` cuando el tema efectivo es claro. El valor
por defecto es **Dawn**.

Los iconos solo se empaquetan si la interfaz los usa; no se cargan desde Internet.

## Fuente

| Opción | Familia |
|---|---|
| **Sistema** | Cantarell, Ubuntu, Noto Sans o la fuente del sistema |
| **Monoespaciada** | JetBrains Mono, Ubuntu Mono o la monoespaciada del sistema |
| **Serif** | Noto Serif, Georgia o la serif del sistema |
| **Otra** | Una fuente instalada que escribas a mano |

Al elegir **Otra** aparece un campo de texto. Escribe el nombre exacto de una familia
instalada, por ejemplo `Fira Sans`. El panel:

- Elimina caracteres que no sean letras, números, guiones, espacios o guion bajo, y
  descarta acentos y signos.
- Si el campo queda vacío, usa la fuente del sistema.
- No descarga ni instala fuentes; si la familia no existe, el navegador usa la siguiente
  de la lista.

El valor por defecto es **Sistema**.

## Tamaño de texto

El control va de **12 a 20 px** y el valor por defecto es **15 px**. Se aplica a toda la
interfaz mediante una variable CSS; los tamaños relativos (títulos, etiquetas, botones) se
escalan a partir de esa base.

No cambia el tamaño de la ventana ni el zoom del navegador. Si el valor guardado es
inválido, se limita al rango permitido.

## Vista compacta

Reduce el espacio vertical de la interfaz:

- Menos relleno superior e inferior en el área de trabajo.
- Filas de listas más juntas.
- Elementos del panel lateral más compactos.
- Paneles con menos relleno.

No cambia el tamaño de texto ni oculta información. Está desactivada por defecto.

## Restablecer

El botón **Restablecer** vuelve a los valores por defecto:

```text
Tema: Sistema
Paleta: Carbon
Iconos: Dawn
Fuente: Sistema
Fuente personalizada: vacía
Tamaño de texto: 15 px
Vista compacta: desactivada
```

No borra el ancho del panel lateral, que se guarda aparte. Tampoco borra datos de Valet,
copias de seguridad ni configuración del sistema.

## Dónde se guardan los ajustes

Se guardan en el almacenamiento local del navegador interno de Electron:

| Clave | Contenido |
|---|---|
| `valet-dashboard:settings` | Tema, paleta, iconos, fuente, tamaño y vista compacta |
| `valet-dashboard:sidebar-width` | Ancho del panel lateral, entre 220 y 420 px |

En Linux, ese almacenamiento suele estar bajo el directorio de datos de usuario de
Electron, normalmente `~/.config/Valet Dashboard/`. No está en
`~/.valet-dashboard/config.json`, que es la configuración de puertos del panel.

Consecuencias:

- Los ajustes son por usuario y por equipo; no se sincronizan.
- Se conservan al cerrar y volver a abrir la app.
- Si se borra el directorio de datos de Electron, vuelven los valores por defecto.
- Si el JSON guardado no se puede leer, se usan los valores por defecto. Si contiene un
  tema, paleta, fuente o icono desconocido, se corrige ese valor; el tamaño de texto se
  limita al rango permitido.
- Al arrancar, los ajustes se aplican antes del primer render para evitar un parpadeo de
  tema.

## Qué no hacen los ajustes

- No cambian el tema del escritorio ni de otras aplicaciones.
- No cambian la configuración de Valet, nginx, PHP o DNS.
- No cambian el idioma: la interfaz está en español.
- No cambian el tamaño de la ventana ni el nivel de zoom.
- No instalan fuentes ni iconos.
- No se exportan ni se importan.
- No hay un tema personalizado con colores propios; solo Carbon y Min.

## Accesibilidad

- Los selectores de tema, paleta, iconos y fuente usan roles `radiogroup` y `radio`.
- El control de tamaño tiene etiqueta accesible.
- El diálogo tiene `role="dialog"`, `aria-modal` y recibe el foco al abrirse.
- `Esc` cierra el diálogo.
- Los iconos decorativos se ocultan a los lectores de pantalla.

## Relacionado

- [Interfaz](Interfaz)
- [Seguridad y copias](Seguridad-y-copias)
