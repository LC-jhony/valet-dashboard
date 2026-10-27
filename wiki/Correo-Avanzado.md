# Funciones avanzadas de Mailpit

Esta página cubre las funciones que van más allá de capturar y leer correo: Relay, Forward,
Chaos, etiquetas automáticas, métricas, webhook, autenticación, TLS, registro, mantenimiento,
ingesta de mensajes y proxy inverso.

## Relay

Relay envía un mensaje a un **SMTP real**. Tiene dos usos:

1. **Manual (Release)**: en un mensaje, pulsa **Release** y elige los destinatarios. Mailpit lo
   entrega al servidor configurado y guarda una copia local.
2. **Automático**: con `MP_SMTP_RELAY_ALL` o `MP_SMTP_RELAY_MATCHING`, todo mensaje (o solo los que
   coinciden) se reenvía al servidor real al recibirse.

### Archivo `relay.yml`

```yaml
host: smtp.mailtrap.io        # obligatorio: host o IP
port: 587                     # opcional, por defecto 25
starttls: true                # opcional, por defecto false
tls: false                    # opcional: conexión TLS directa
allow-insecure: false         # opcional: no validar el certificado
auth: plain                   # none | plain | login | cram-md5
username: usuario-demo
password: contraseña-demo
return-path: rebotes@ejemplo.test
override-from: no-reply@ejemplo.test
allowed-recipients: '@ejemplo\.test$'
blocked-recipients: '@prohibido\.test$'
preserve-message-ids: true
forward-smtp-errors: false
```

| Clave | Para qué sirve |
|---|---|
| `host`, `port` | Servidor SMTP de salida |
| `starttls` | Negocia TLS sobre el puerto normal |
| `tls` | Cifra desde el primer byte (normalmente puerto 465) |
| `allow-insecure` | Acepta certificados no confiables |
| `auth` | Tipo de autenticación; `none` si el servidor no pide |
| `username`, `password` | Credenciales para `plain` o `login` |
| `secret` | Secreto para `cram-md5` |
| `return-path` | Sustituye el Return-Path de los mensajes reenviados |
| `override-from` | Sustituye la dirección From; guarda la original en `X-Original-From` |
| `allowed-recipients` | Regex que limita a quién se puede reenviar desde UI/API |
| `blocked-recipients` | Regex que bloquea destinatarios, también en relay automático |
| `preserve-message-ids` | Conserva el Message-ID original |
| `forward-smtp-errors` | Devuelve los errores SMTP al cliente en vez de solo registrarlos |

### Relay automático

| Opción | Efecto |
|---|---|
| **Relay de todos los mensajes** (`MP_SMTP_RELAY_ALL`) | Reenvía todo a los destinatarios originales |
| **Relay solo a estos destinatarios** (`MP_SMTP_RELAY_MATCHING`) | Solo si el destinatario casa con la regex, por ejemplo `@ejemplo\.test$` |

Las dos opciones son excluyentes. `allowed-recipients` no se aplica al relay automático;
`blocked-recipients` sí.

El relay automático **pasa el mensaje tal cual**, sin reescribirlo: `return-path`,
`override-from` y `preserve-message-ids` solo se aplican a los mensajes liberados a mano desde la
interfaz o la API.

> Relay envía correo real. Úsalo con un servidor de pruebas (Mailtrap, MailHog de staging) o con
> una cuenta que puedas permitirte. No apuntes a destinatarios de producción por accidente.

## Forward

Forward envía una **copia a una dirección fija**. Es útil para revisar todo el correo de varios
proyectos en un solo buzón.

### Archivo `forward.yml`

```yaml
to: bandeja@ejemplo.test      # obligatorio; varias direcciones separadas por comas
host: smtp.ejemplo.test
port: 587
starttls: true
auth: plain
username: usuario-demo
password: contraseña-demo
return-path: rebotes@ejemplo.test
override-from: no-reply@ejemplo.test
forward-smtp-errors: false
```

| Relay | Forward |
|---|---|
| Reenvía a los destinatarios del mensaje | Reenvía siempre a `to` |
| Se activa a mano (**Release**) o con relay automático | Se activa al guardar el YAML |
| Permite elegir destinatarios al liberar | Destino fijo |

## Chaos

Chaos hace que el servidor SMTP **falle a propósito** para probar cómo reacciona tu aplicación:
reintentos, colas, mensajes de error, etc.

### Etapas

| Etapa | Cuándo falla |
|---|---|
| `Sender` | Al recibir el remitente (`MAIL FROM`) |
| `Recipient` | Al recibir los destinatarios (`RCPT TO`) |
| `Authentication` | Al autenticar (requiere auth SMTP configurada) |

### Sintaxis

```text
Etapa:código:probabilidad,Etapa:código:probabilidad
```

- `código`: entre `400` y `599`.
- `probabilidad`: entero de `0` a `100`.

Ejemplos:

```dotenv
MP_ENABLE_CHAOS=true
MP_CHAOS_TRIGGERS=Sender:451:50,Recipient:451:20
```

Ese ejemplo rechaza aproximadamente la mitad de los envíos en el remitente y una quinta parte en
los destinatarios. No se suman: cada etapa tiene su propia probabilidad.

- Si solo activas `MP_ENABLE_CHAOS`, las probabilidades son `0` y no se rechaza nada.
- Definir `MP_CHAOS_TRIGGERS` activa Chaos por sí solo, aunque no marques **Activar chaos**.
- La probabilidad `100` garantiza el fallo.
- Los disparadores también se pueden cambiar en caliente desde la interfaz de Mailpit
  (**settings → Chaos**) o con `PUT /api/v1/chaos`. Al reiniciar, vuelven a los del entorno.
- El error que recibe el cliente es `<código> Chaos <etapa> error`, por ejemplo
  `451 Chaos recipient error`.

En el panel, el campo **Disparadores** de la pestaña Chaos usa esa misma sintaxis
`etapa:código:probabilidad`; no acepta JSON.

## Etiquetas automáticas

Además de añadirlas a mano, Mailpit puede etiquetar al recibir:

### Cabecera `X-Tags`

```text
X-Tags: Tienda, Pedidos
```

Separa las etiquetas con comas. Se puede desactivar con `MP_TAGS_DISABLE=x-tags`.

Ejemplo con `curl`:

```bash
curl -X POST http://127.0.0.1:8025/api/v1/send \
  -H 'Content-Type: application/json' \
  -d '{
    "From": {"Email": "pedidos@tienda.test"},
    "To": [{"Email": "cliente@ejemplo.test"}],
    "Subject": "Pedido confirmado",
    "Text": "Gracias",
    "Headers": {"X-Tags": "Tienda, Pedidos"}
  }'
```

### Direcciones con `+`

`cliente+tienda@ejemplo.test` recibe la etiqueta `tienda`. Se pueden encadenar:
`cliente+tienda+urgente@ejemplo.test`. Funciona en From, To, Cc y Bcc. Se desactiva con
`MP_TAGS_DISABLE=plus-addresses`.

### Archivo `tags.yml`

```yaml
filters:
  - match: from:@tienda.test
    tags: Tienda, Pedidos
  - match: subject:"restablece tu contraseña"
    tags: Seguridad
  - match: '"factura adjunta"'
    tags: Facturas
```

| Clave | Detalle |
|---|---|
| `match` | Misma sintaxis que el buscador, incluidas comillas para frases exactas |
| `tags` | Una o varias etiquetas separadas por comas |

`match` también busca en todas las cabeceras. No admite `tag:`, `is:tagged` ni `is:read`, porque el
mensaje aún no tiene etiquetas y siempre llega sin leer.

### Reglas en línea (`MP_TAG`)

La variable `MP_TAG` acepta varias reglas separadas por espacios con el formato
`Etiqueta=coincidencia`:

```dotenv
MP_TAG=Pedidos=from:@tienda.test Seguridad=subject:restablece "Facturas"="factura adjunta"
```

Es útil para una o dos reglas. Para más, usa `tags.yml`.

### Otras opciones

| Opción | Efecto |
|---|---|
| `MP_TAGS_TITLE_CASE` | Capitaliza las etiquetas nuevas creadas por `X-Tags` o direcciones con `+` (no las de los filtros) |
| `MP_TAGS_DISABLE` | `plus-addresses`, `x-tags` o ambos, separados por coma |
| `MP_TAGS_USERNAME` | Añade una etiqueta con el usuario SMTP/API autenticado |

Los nombres de etiqueta admiten `a-z`, `A-Z`, `0-9`, `-`, `.`, `_`, `@` y espacios, entre 1 y 100
caracteres.

## Métricas Prometheus

Activa **Configuración → Prometheus → Activar Prometheus**:

| Valor | Resultado |
|---|---|
| `true` | Expone `/metrics` en el mismo puerto que la UI (`http://127.0.0.1:8025/metrics`) |
| `0.0.0.0:9090` | Abre un servidor de métricas aparte en el puerto 9090 |
| vacío | Desactivado |

Comprobación:

```bash
curl -s http://127.0.0.1:8025/metrics | head
```

Ejemplo de `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: mailpit
    static_configs:
      - targets: ['127.0.0.1:8025']
```

Las métricas incluyen el estado del proceso Go y los contadores de mensajes aceptados, rechazados e
ignorados. No expongas `/metrics` a Internet sin auth ni firewall.

## Webhook

Mailpit hace un `POST` JSON a la URL indicada **cada vez que recibe un mensaje**. El cuerpo es el
resumen del mensaje, con el mismo esquema que `GET /api/v1/message/{ID}`.

```dotenv
MP_WEBHOOK_URL=https://app.test/hooks/mailpit
MP_WEBHOOK_LIMIT=1
MP_WEBHOOK_DELAY=0
```

| Opción | Detalle |
|---|---|
| **URL** | Admite Basic Auth en la propia URL: `https://usuario:clave@host/hook` |
| **Límite** | Segundos entre llamadas. `1` = como máximo una por segundo; `0` = sin límite |
| **Retardo** | Espera en segundos antes de cada llamada |

Notas:

- Solo se dispara con mensajes **recibidos**, no al borrar ni modificar.
- Las llamadas fallidas **no se reintentan** y los mensajes que llegan mientras se espera el límite
  **se descartan**, no se encolan.
- Si configuras **Etiqueta del servidor** (`MP_LABEL`), la petición lleva la cabecera
  `Mailpit-Label`.
- Si la URL usa un certificado propio, el proceso de Mailpit debe confiar en él; no hay opción para
  ignorar TLS en el webhook.

Ejemplo de receptor en Laravel:

```php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

Route::post('/hooks/mailpit', function (Request $request) {
    Log::info('Correo nuevo', $request->all());
    return response()->noContent();
});
```

Recuerda excluir esa ruta de CSRF (`bootstrap/app.php` o `VerifyCsrfToken`).

## Autenticación en detalle

| Grupo | Variable | Archivo |
|---|---|---|
| Web UI y API | `MP_UI_AUTH_FILE` | `auth/ui.htpasswd` |
| SMTP | `MP_SMTP_AUTH_FILE` | `auth/smtp.htpasswd` |
| POP3 | `MP_POP3_AUTH_FILE` | `auth/pop3.htpasswd` |
| Send API | `MP_SEND_API_AUTH_FILE` | `auth/sendApi.htpasswd` |

- Formato del archivo: `usuario:hash` por línea, permisos `0600`.
- Con `htpasswd` instalado se usa bcrypt. Sin `htpasswd`, el panel escribe `usuario:contraseña` en
  texto plano. Mailpit acepta ambos formatos.
- SMTP exige TLS para autenticar por defecto. Si tu cliente no usa TLS, activa
  **Permitir auth sin TLS** (`MP_SMTP_AUTH_ALLOW_INSECURE`).
- **Aceptar cualquier credencial** (`MP_SMTP_AUTH_ACCEPT_ANY`) deja entrar con cualquier usuario y
  contraseña, incluso sin ninguno. Es cómodo en local, pero no protege nada.
- La autenticación de Send API es independiente de la de la UI. Si activas las dos, cada endpoint
  usa la suya.
- POP3 **solo arranca** si hay `MP_POP3_AUTH_FILE` o credenciales equivalentes por entorno.

Uso desde la terminal:

```bash
# UI/API con Basic Auth
curl -u usuario:contraseña http://127.0.0.1:8025/api/v1/info

# SMTP con auth (ejemplo con swaks)
swaks --server 127.0.0.1:1025 --auth-user usuario --auth-password contraseña \
      --to tu@ejemplo.test --from dev@ejemplo.test
```

## TLS en detalle

El panel usa **un certificado para todo**: UI/API, SMTP y POP3.

- **Autofirmado**: genera `mailpit.crt` y `mailpit.key` (RSA 2048, 825 días, CN `localhost`, SAN
  `DNS:localhost` e `IP:127.0.0.1`) con `openssl`.
- **Propio**: usa las rutas que indiques. Deben ser legibles por el usuario que ejecuta el
  servicio.
- La clave se guarda con permisos `0600`.
- La vista embebida acepta el certificado autofirmado; el navegador externo y otros clientes no.
- Para clientes propios, añade el certificado a su almacén de confianza o usa `--insecure` solo en
  pruebas.

Variables que escribe el panel:

```dotenv
MP_UI_TLS_CERT=/ruta/mailpit.crt
MP_UI_TLS_KEY=/ruta/mailpit.key
MP_SMTP_TLS_CERT=/ruta/mailpit.crt
MP_SMTP_TLS_KEY=/ruta/mailpit.key
MP_POP3_TLS_CERT=/ruta/mailpit.crt
MP_POP3_TLS_KEY=/ruta/mailpit.key
```

Comprobación rápida:

```bash
curl -k https://127.0.0.1:8025/livez
openssl s_client -connect 127.0.0.1:1025 -starttls smtp
```

## Registro y mantenimiento

### Ver el registro

**Integraciones → Registro → Cargar** muestra las últimas 250 líneas. El origen depende de la
configuración:

- Si defines **Archivo de registro** (`MP_LOG_FILE`), lee ese archivo.
- Si no, usa `journalctl --user -u valet-dashboard-mailpit`.

Desde la terminal:

```bash
journalctl --user -u valet-dashboard-mailpit -n 200 --no-pager
journalctl --user -u valet-dashboard-mailpit -f
```

### Vaciar el buzón

- **Vaciar buzón** en la página Correo (pide confirmación).
- `DELETE /api/v1/messages`.
- **Delete all** en la interfaz de Mailpit, si no lo ocultaste.

El vaciado borra los mensajes, no la base ni la configuración.

### Actualizar y revertir

- **Actualizar a vX.Y.Z** descarga el binario nuevo, lo verifica y reinicia.
- El binario anterior queda en `~/.valet-dashboard/bin/mailpit.prev`.
- Si el arranque falla, el panel restaura la configuración y el binario previos.

### Desinstalar

**Integraciones → Mantenimiento → Desinstalar Mailpit**:

![Mantenimiento y desinstalación](img/correo-integraciones-2.png)

1. Detiene el servicio.
2. Elimina la unidad de systemd y el binario gestionado.
3. Conserva la configuración y el buzón, salvo que marques **Borrar también los correos
   almacenados**, que elimina `~/.valet-dashboard/mailpit/mailpit.db`.

### Copias

| Qué | Dónde |
|---|---|
| `.env` de Laravel | `~/.valet-dashboard/backups/<fecha>/env/` |
| `php.ini` | `~/.valet-dashboard/backups/<fecha>/php/` |
| Correos | `~/.valet-dashboard/mailpit/mailpit.db` (copia el archivo con el servicio detenido) |

## Ingesta, sockets y proxy

### Importar mensajes

`mailpit ingest` lee mensajes `.eml` individuales (no `.mbox`) y los entrega por SMTP, como si los
enviara una aplicación:

```bash
~/.valet-dashboard/bin/mailpit ingest ~/correos/ --recent 30 --smtp-addr 127.0.0.1:1025
```

| Opción | Efecto |
|---|---|
| `--recent N` | Solo archivos modificados en los últimos N días |
| `--smtp-addr host:puerto` | Destino; por defecto `localhost:1025` |
| `--max-message-size N` | Tamaño máximo en MB; `0` sin límite |

Si repites una importación, activa **Ignorar Message-ID duplicados**
(`MP_IGNORE_DUPLICATE_IDS`) para no llenar el buzón de copias. La ingesta no está en el panel: se
lanza desde la terminal con el binario gestionado.

### Sockets Unix

Mailpit puede escuchar en un socket en vez de en un puerto. La sintaxis es
`unix:<ruta>:<permisos>`:

```bash
mailpit --listen unix:/var/run/mailpit/http.sock:660 \
        --smtp unix:/var/run/mailpit/smtp.sock:660
```

- HTTP y SMTP necesitan sockets distintos.
- Los sockets **no admiten TLS**: si necesitas HTTPS, termina el TLS en el proxy.
- El panel valida `host:puerto`, así que esta opción se configura fuera del panel.

### Proxy inverso

Si pones Nginx, Apache o Caddy delante de Mailpit:

- **Conserva la cabecera `Host`** (`proxy_set_header Host $http_host` o `ProxyPreserveHost On`).
  Mailpit rechaza peticiones cuyo `Origin` no coincide con el host.
- Enruta también el **WebSocket**; sin él no hay avisos en vivo ni notificaciones.
- Si publicas la UI en una subruta, usa el mismo valor en **Webroot** (`MP_WEBROOT`).
- Como alternativa a conservar `Host`, declara los hosts en **Hosts permitidos**
  (`MP_ALLOWED_HOSTS`) o los orígenes en **CORS de la API** (`MP_API_CORS`).

## CLI `devenv`

El CLI Go complementa al panel para trabajar en terminal:

```bash
devenv mail                 # inicia Mailpit y muestra UI y SMTP
devenv mail --env           # además escribe MAIL_* en el .env del sitio actual
devenv mail --open          # abre la interfaz web en el navegador
devenv mail mailpit:v1.31   # fija una versión concreta
devenv service start mailpit
devenv service stop mailpit
```

Versiones disponibles: `v1.30`, `v1.31` y `v1.32` (predeterminada). `--env` fusiona las variables
de correo en el bloque `# >>> devenv >>>` sin borrar las de base de datos, Redis o Meilisearch.
Como la aplicación corre dentro de la red `devenv`, `MAIL_HOST` apunta al alias del contenedor y
`MAIL_PORT` al puerto interno `1025`, no al puerto publicado en el equipo.

## Ejemplo de `mailpit.env`

Así se ve un entorno generado por el panel (los valores cambian según tu configuración):

```dotenv
# Generado por Valet Dashboard. No edites a mano: usa la pestaña Correo.

MP_COMPRESSION=1
MP_DATABASE=/home/usuario/.valet-dashboard/mailpit/mailpit.db
MP_DISABLE_VERSION_CHECK=true
MP_MAX_MESSAGES=500
MP_MAX_MESSAGE_SIZE=50
MP_POP3_BIND_ADDR=127.0.0.1:1110
MP_SMTP_BIND_ADDR=127.0.0.1:1025
MP_UI_BIND_ADDR=127.0.0.1:8025
```

## Lista de comprobación de seguridad

- [ ] UI, SMTP y POP3 escuchan en `127.0.0.1`, no en `0.0.0.0`.
- [ ] Auth activa en UI/API y SMTP si otra persona usa la máquina.
- [ ] TLS activo si algo sale de localhost.
- [ ] `/metrics` no expuesto sin firewall.
- [ ] Buzón vacío al terminar: puede contener tokens y datos personales.
- [ ] Relay y Forward apuntan a servidores de prueba, no a producción.

## Relacionado

- [Correo](Correo)
- [Interfaz de Mailpit](Correo-Interfaz)
- [Configuración](Correo-Configuracion)
- [Laravel](Correo-Laravel)
- [WordPress](Correo-WordPress)
