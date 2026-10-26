# PHP

La pestaña **PHP** muestra las versiones de PHP-FPM instaladas y permite cambiar la
versión que usa Valet.

## Detección de versiones

El panel busca binarios con el patrón `php-fpmX.Y` en:

- `/usr/sbin`
- `/usr/bin`

Las versiones se muestran de mayor a menor, ordenadas numéricamente. La versión actual se
obtiene ejecutando:

```bash
php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;'
```

Solo se listan versiones de **PHP-FPM**, no instalaciones de PHP CLI sueltas. Si no hay
ninguna, se muestra un estado vacío con un ejemplo de paquete a instalar (`php8.3-fpm`).

## Panel lateral

- Muestra la versión **en uso** y el subtítulo `php-fpm`.
- Lista las versiones instaladas con la etiqueta «en uso» en la actual.
- Al hacer clic en una versión, se resalta y se desplaza hasta su fila.
- Avisa de que cambiar la versión reinicia PHP-FPM.

## Cambiar la versión en uso

En la lista principal, cada versión que no está en uso tiene el botón
**Usar esta versión**. Al pulsarlo, el panel ejecuta el equivalente a:

```bash
valet use php@X.Y
```

- La operación se ejecuta como tu usuario y usa el ayudante de contraseña del panel.
- Al terminar, la lista se recarga y la etiqueta «en uso» cambia.
- El cambio reinicia PHP-FPM.
- La configuración de nginx no se modifica.

Puede pedir la contraseña de administrador si Valet necesita elevar permisos.

## Qué muestra la página

- Número de versiones instaladas.
- Versión actual con una etiqueta verde.
- Lista de versiones y botón para cambiar.
- Aviso de error si falla la consulta o el cambio.

## Requisitos

Para que la pestaña funcione correctamente necesitas:

- Valet instalado y accesible (`valet` en el `PATH` o en el Composer aislado del panel).
- Al menos un servicio `phpX.Y-fpm` instalado.
- PHP CLI disponible para detectar la versión actual.
- El ayudante de contraseña preparado, que el panel crea automáticamente.

## Limitaciones

- No instala ni desinstala versiones de PHP.
- No instala extensiones de PHP.
- No edita `php.ini` ni configuraciones de PHP-FPM.
- No permite seleccionar una versión distinta por sitio.
- No muestra el estado detallado de cada servicio PHP-FPM; para eso usa
  [Servicios](Servicios).
- No comprueba que el sitio concreto use la versión elegida; Valet decide la configuración.

## Problemas habituales

- **No aparece ninguna versión**: instala un paquete `phpX.Y-fpm` con el gestor de tu
  distribución y pulsa **Actualizar**.
- **La versión actual aparece vacía**: PHP CLI no está instalado o no responde.
- **No se puede cambiar la versión**: comprueba que Valet está instalado correctamente y
  que el diálogo de contraseña puede mostrarse.
- **El cambio falla**: revisa el mensaje de error; suele indicar que Valet no encontró la
  versión solicitada o que PHP-FPM no pudo reiniciarse.
