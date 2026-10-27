# Servicios

La pestaña **Servicios** permite ver el estado de los servicios del sistema relacionados con
Valet y actuar sobre ellos sin abrir una terminal. Todas las acciones se ejecutan con
`systemctl` y pasan por la autenticación de polkit.

## Qué servicios aparecen

El panel no muestra todos los servicios de systemd. Filtra una lista cerrada de unidades:

| Unidad | Para qué sirve |
|---|---|
| `nginx` | Servidor web de Valet |
| `apache2` | Servidor Apache alternativo |
| `dnsmasq` | DNS del sistema o restos del DNS clásico |
| `valet-dns` | DNS clásico de Valet |
| `valet-dashboard-dns` | DNS seguro del panel, en `127.0.0.1:5354` |
| `mysql` / `mysqld` / `mariadb` | Servidores MySQL o MariaDB |
| `redis` / `redis-server` | Redis |
| `postgresql` | PostgreSQL |
| `phpX.Y-fpm` | PHP-FPM de cada versión instalada |

La lista se obtiene de:

```bash
systemctl list-unit-files --type=service --no-legend --no-pager
```

Se descartan los alias. El estado se consulta con `systemctl is-active`. Por eso:

- Solo aparecen unidades **instaladas** en el sistema.
- Un servicio `httpd` o un `php-fpm` genérico **no** aparece: no está en la lista permitida.
- Un servicio que existe pero está enmascarado puede aparecer como detenido.
- Los servicios de usuario (`systemctl --user`) no se gestionan.

Mailpit es la excepción: se ejecuta como servicio de usuario y se gestiona desde la
pestaña [Correo](Correo), no desde esta lista.

## Panel lateral

Muestra:

- Cada servicio con su icono, nombre y estado (`activo` o `detenido`).
- Un punto verde si está activo; gris si no.
- Un resumen con activos y detenidos.
- La nota de que las acciones usan `systemctl` y pueden pedir permisos.

Al pulsar un servicio del panel, se resalta y se desplaza hasta su fila en el área principal.
En pantallas pequeñas, el panel se cierra al elegir.

## Lista principal

Cada fila muestra:

- Icono según el tipo de servicio.
- Nombre de la unidad, sin el sufijo `.service`.
- Estado: **en ejecución** o **detenido**.
- Etiqueta **activo** o **detenido**.
- Botones **Iniciar** / **Detener** y **Reiniciar**.

La barra superior indica cuántos servicios hay y cuántos están activos.

### Acciones

| Botón | Comando | Cuándo está disponible |
|---|---|---|
| **Iniciar** | `systemctl start <unidad>` | El servicio está detenido |
| **Detener** | `systemctl stop <unidad>` | El servicio está activo |
| **Reiniciar** | `systemctl restart <unidad>` | El servicio está activo |

- Cada acción se ejecuta con `pkexec systemctl ...`; aparecerá el diálogo de polkit del
  escritorio.
- Los botones se deshabilitan mientras hay una acción en curso.
- Al terminar, la lista de servicios se recarga y, si la pestaña **Puertos** ya se había
  cargado, también se actualiza para reflejar los puertos en escucha.
- No hay confirmación antes de detener un servicio: la acción se ejecuta directamente tras
  autenticarte.
- No se ejecuta `enable` ni `disable`; los cambios de arranque automático no se gestionan
  desde aquí.

## Qué significa cada servicio

### nginx

Es el servidor que atiende los sitios de Valet. Si lo detienes, los sitios dejan de
responder hasta que lo inicies o reinicies.

### valet-dashboard-dns

Es el DNS seguro del panel. Escucha solo en `127.0.0.1:5354` y resuelve el dominio de
Valet hacia `127.0.0.1`. Si usas el modo **Seguro**, este servicio debe estar activo para
que `*.test` resuelva. No lo confundas con el `dnsmasq` del sistema.

### dnsmasq

Puede ser el servicio DNS del sistema o un resto del DNS clásico de Valet. En el modo
**Seguro** del panel no es necesario que esté activo: el panel usa su propia instancia de
dnsmasq dentro de `valet-dashboard-dns`.

### valet-dns

Servicio DNS que instala el Valet clásico. Si aparece, probablemente hay restos de una
instalación clásica. El panel no lo elimina automáticamente.

### apache2

Apache puede ocupar los puertos 80/443 y entrar en conflicto con nginx. Desde
[Puertos](Puertos) puedes moverlo a 8080/8443 o detenerlo. En **Servicios** también puedes
iniciarlo, detenerlo o reiniciarlo.

### phpX.Y-fpm

Cada versión de PHP-FPM es un servicio independiente. Si el servicio de la versión que usa
un sitio está detenido, el sitio puede devolver un error 502. Cambiar la versión en
[PHP](PHP) reinicia PHP-FPM a través de Valet.

### MySQL, MariaDB, PostgreSQL y Redis

El panel no los instala ni los configura. Solo permite iniciar, detener o reiniciar los
que ya existan en el sistema. Detener una base de datos desconecta a las aplicaciones que
la usen.

### Mailpit

No aparece en esta lista porque es una unidad de **usuario**. Se instala, configura y
controla desde [Correo](Correo). Para gestionarlo en terminal:

```bash
systemctl --user status valet-dashboard-mailpit
systemctl --user restart valet-dashboard-mailpit
journalctl --user -u valet-dashboard-mailpit -n 100 --no-pager
```

## Errores habituales

| Mensaje | Causa | Qué hacer |
|---|---|---|
| `Servicio desconocido` | La unidad desapareció o no está en la lista permitida | Pulsa **Actualizar** y revisa `systemctl list-unit-files` |
| `Acción no válida` | Se pidió una acción distinta de start/stop/restart | Es un error interno; recarga la página |
| `Error executing command as another user: Request dismissed` | Se canceló el diálogo de polkit | Repite la acción y autentica |
| `Job for <unidad>.service failed` | El servicio no pudo arrancar | Consulta `systemctl status` y `journalctl` |
| No aparece un servicio | No está instalado, es un alias o no está en la lista permitida | Instálalo o gestiónalo desde la terminal |

## Diagnóstico

```bash
systemctl status nginx --no-pager -l
systemctl status valet-dashboard-dns --no-pager -l
systemctl status apache2 --no-pager -l
systemctl --failed --no-pager
journalctl -u nginx -b --no-pager
journalctl -u valet-dashboard-dns -b --no-pager
```

Para ver todos los servicios de PHP-FPM instalados:

```bash
systemctl list-unit-files 'php*-fpm.service'
```

## Limitaciones

- No habilita ni deshabilita servicios al arranque.
- No muestra registros, consumo de CPU/memoria ni tiempos de arranque.
- No permite editar unidades, máscaras ni dependencias.
- No gestiona servicios de usuario ni contenedores Docker. Mailpit (usuario) se gestiona
  en [Correo](Correo).
- No instala servicios nuevos.
- No reinicia automáticamente servicios dependientes.
- No confirma antes de detener un servicio.

## Relacionado

- [Puertos](Puertos)
- [PHP](PHP)
- [Correo](Correo)
- [Instalación](Instalacion)
- [Solución de problemas](Solucion-de-problemas)
