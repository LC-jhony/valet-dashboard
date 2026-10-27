# WordPress con Mailpit

WordPress envía correo con `wp_mail()`, que por dentro usa PHPMailer. Mailpit puede recibir ese
correo de tres formas. Elige una:

| Método | Cuándo usarlo | Dificultad |
|---|---|---|
| **A. `sendmail_path`** | La más simple; todo el correo de PHP pasa por Mailpit | Muy baja |
| **B. mu-plugin con PHPMailer** | Necesitas auth o TLS, o quieres controlar el remitente | Baja |
| **C. Plugin SMTP** | Prefieres configurarlo desde el escritorio de WordPress | Baja |

No hace falta usar las tres. Con una basta.

## Método A: `sendmail_path` (recomendado para empezar)

**Correo → Integraciones → PHP · sendmail_path → Activar** cambia `sendmail_path` en
`fpm/php.ini` y `cli/php.ini` para que `mail()` entregue en Mailpit:

```ini
sendmail_path = /home/usuario/.valet-dashboard/bin/mailpit sendmail -S 127.0.0.1:1025
```

Como WordPress usa `mail()` cuando no hay un transporte SMTP configurado, **todo** el correo del
sitio (recuperación de contraseña, comentarios, WooCommerce, formularios) acaba en Mailpit.

Ventajas: no toca el código del tema ni instala plugins.
Limitaciones: no permite usuario/contraseña SMTP ni STARTTLS; para eso usa el método B.

Después de activarlo, pulsa **Probar mail()** en la misma pantalla. Si el contador de Mailpit sube,
está funcionando. El panel guarda una copia del `php.ini` anterior y reinicia php-fpm.

## Método B: mu-plugin con PHPMailer

Un **mu-plugin** se carga siempre y no se puede desactivar desde el escritorio. Es la forma más
estable de forzar SMTP en un sitio de desarrollo.

Antes de nada, declara el entorno en `wp-config.php` (WordPress asume `production` si no lo
indicas):

```php
define('WP_ENVIRONMENT_TYPE', 'local');
```

Crea `wp-content/mu-plugins/mailpit.php` (la carpeta `mu-plugins` puede no existir; créala):

```php
<?php
/**
 * Plugin Name: Mailpit (desarrollo)
 * Description: Envía todo el correo de WordPress a Mailpit.
 */

add_action('phpmailer_init', function ($phpmailer) {
    // Solo actúa en entornos locales; en producción no toca nada.
    if (wp_get_environment_type() !== 'local') {
        return;
    }

    $phpmailer->isSMTP();
    $phpmailer->Host = '127.0.0.1';
    $phpmailer->Port = 1025;
    $phpmailer->SMTPAuth = false;
    $phpmailer->SMTPSecure = '';
    $phpmailer->SMTPAutoTLS = false;
    $phpmailer->Timeout = 10;
});
```

Con **Autenticación → SMTP** activa:

```php
$phpmailer->SMTPAuth = true;
$phpmailer->Username = 'valet';
$phpmailer->Password = 'tu-contraseña';
```

Con **TLS** activo (STARTTLS):

```php
$phpmailer->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
$phpmailer->SMTPAutoTLS = true;
```

Con **Exigir TLS directo**:

```php
$phpmailer->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS;
$phpmailer->Port = 1025; // el puerto TLS que hayas configurado
```

El certificado autofirmado no es de confianza para PHP. En local es más simple dejar TLS
desactivado.

### Cambiar el remitente

Mailpit acepta cualquier remitente, pero algunos plugins validan el dominio. Puedes forzarlo:

```php
add_filter('wp_mail_from', fn () => 'wordpress@ejemplo.test');
add_filter('wp_mail_from_name', fn () => 'Blog Demo');
```

El guard del ejemplo hace que el mu-plugin **solo** actúe cuando el sitio declara
`WP_ENVIRONMENT_TYPE=local`. Si la constante no existe o vale `production`, no intercepta nada:
falla del lado seguro.

## Método C: plugin SMTP

Si prefieres no tocar archivos, instala un plugin como **WP Mail SMTP**, **FluentSMTP** o
**Post SMTP** y configura un servidor SMTP manual:

| Campo | Valor |
|---|---|
| Mailer | Other SMTP / SMTP personalizado |
| Host | `127.0.0.1` |
| Port | `1025` |
| Encryption | None (o TLS si lo activaste) |
| Auto TLS | Off |
| Authentication | Off (o las credenciales de Mailpit) |
| From Email | Cualquiera, por ejemplo `wordpress@ejemplo.test` |

El plugin enviará una prueba desde su propia pantalla. Si llega a Mailpit, el resto de
`wp_mail()` también.

Ventaja: todo desde el escritorio. Desventaja: si cambias de plugin o restauras la base de datos,
la configuración se pierde.

## Comprobar que funciona

### Desde WP-CLI

```bash
wp eval 'var_dump( wp_mail("tu@ejemplo.test", "Prueba desde WordPress", "Si ves esto, Mailpit captura el correo.") );'
```

Debe devolver `bool(true)` y el mensaje debe aparecer en `http://127.0.0.1:8025`.

### Desde el escritorio

1. **Ajustes → General** cambia el correo del administrador por uno de prueba y guarda.
2. **Usuarios → Tu perfil** cambia tu correo y guarda.
3. Cierra sesión y usa **¿Has olvidado tu contraseña?**.
4. El correo de restablecimiento debe llegar a Mailpit, no a tu buzón real.

### Desde la API

```bash
curl -s http://127.0.0.1:8025/api/v1/info
```

El contador `Messages` sube con cada envío.

## WooCommerce, formularios y otros plugins

- **WooCommerce** usa `wc_mail()`, que termina en `wp_mail()`. Queda cubierto por A, B o C.
- **Contact Form 7**, **WPForms**, **Gravity Forms** y **Elementor Forms** usan `wp_mail()`.
- **Comentarios y recuperación de contraseña** usan `wp_mail()`.
- Plugins que envían por su propia API (Mailchimp, SendGrid, Brevo) **no pasan por WordPress** y
  no se capturan. Tendrías que cambiar su configuración o desactivarlos en local.

## WordPress en Docker

Dentro del contenedor, `127.0.0.1` es el contenedor. Usa:

```php
$phpmailer->Host = 'host.docker.internal';
```

O el nombre del servicio de Mailpit en la red de Docker. El CLI `devenv mail --env` escribe el
alias correcto cuando el proyecto corre en la red `devenv`.

## Problemas habituales

| Síntoma | Causa | Solución |
|---|---|---|
| `wp_mail()` devuelve `false` | Mailpit detenido, puerto incorrecto o extensión SMTP mal configurada | Arranca Mailpit y revisa `Host`/`Port` |
| No llega nada y no hay error | Otro plugin SMTP pisa la configuración o el correo va por API externa | Desactiva plugins SMTP y revisa cuál envía |
| Error de conexión TLS | `SMTPAutoTLS` activo contra un Mailpit sin TLS | Ponlo en `false` y `SMTPSecure = ''` |
| Error de autenticación | Auth SMTP activa y credenciales vacías | Copia usuario y contraseña de **Autenticación → SMTP** |
| El correo va a la bandeja real | `sendmail_path` no aplicado o plugin SMTP con otro host | Revisa **Integraciones → PHP** y la configuración del plugin |
| Los cambios no se aplican | Caché de objetos o de plugins | Recarga la página, limpia la caché y comprueba que php-fpm se reinició |
| El remitente se rechaza | Validación de dominio del propio plugin | Cambia el From con `wp_mail_from` o usa uno permitido |
| El destinatario se rechaza | Regla `MP_SMTP_ALLOWED_RECIPIENTS` en Mailpit | Ajusta la regla o envía a un destinatario permitido |

Para depurar, activa en `wp-config.php`:

```php
define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
define('WP_DEBUG_DISPLAY', false);
```

El archivo `wp-content/debug.log` mostrará los errores de PHPMailer.

## Seguridad

- El mu-plugin anterior está pensado para desarrollo. No lo dejes activo en producción.
- No guardes contraseñas reales en el repositorio. Si usas auth SMTP, cárgala desde una variable de
  entorno o desde `wp-config.php`.
- El buzón de Mailpit puede contener enlaces de restablecimiento de contraseña: vacíalo al
  terminar y no lo expongas a la red.

## Relacionado

- [Correo](Correo)
- [Interfaz de Mailpit](Correo-Interfaz)
- [Configuración](Correo-Configuracion)
- [Laravel](Correo-Laravel)
