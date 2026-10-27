/** Contrato del módulo Mailpit compartido por el proceso principal, el preload y la interfaz. */

export type MailpitBinarySource = 'managed' | 'system'

export type MailpitGroupId =
  | 'general' | 'ui' | 'smtp' | 'pop3' | 'relay'
  | 'forward' | 'chaos' | 'tags' | 'metrics' | 'webhook'

export interface MailpitGroup {
  id: MailpitGroupId
  label: string
  hint: string
}

export type MailpitFieldKind =
  | 'text' | 'number' | 'path' | 'secret' | 'select' | 'bool' | 'duration'

export interface MailpitField {
  key: string
  group: MailpitGroupId
  label: string
  kind: MailpitFieldKind
  def?: string
  options?: { value: string; label: string }[]
  help?: string
  placeholder?: string
  advanced?: boolean
}

export const MAILPIT_GROUPS: MailpitGroup[] = [
  { id: 'general', label: 'General', hint: 'Almacenamiento, límites, compresión y registro.' },
  { id: 'ui', label: 'Web UI y API', hint: 'Dirección de escucha, seguridad del navegador, CORS y SpamAssassin.' },
  { id: 'smtp', label: 'SMTP', hint: 'Servidor de correo entrante, TLS y listas de destinatarios.' },
  { id: 'pop3', label: 'POP3', hint: 'Servidor POP3 opcional para clientes de correo.' },
  { id: 'relay', label: 'Relay', hint: 'Reenvío de mensajes a un SMTP real mediante archivo YAML.' },
  { id: 'forward', label: 'Forward', hint: 'Copia automática de mensajes a otro SMTP.' },
  { id: 'chaos', label: 'Chaos', hint: 'Simulación de fallos y latencia para probar aplicaciones.' },
  { id: 'tags', label: 'Etiquetas', hint: 'Clasificación automática por reglas X-Tag y remitente.' },
  { id: 'metrics', label: 'Prometheus', hint: 'Métricas del servidor en /metrics.' },
  { id: 'webhook', label: 'Webhook', hint: 'Notificación HTTP cuando llega un mensaje.' }
]

export const MAILPIT_FIELDS: MailpitField[] = [
  // General
  { key: 'MP_DATABASE', group: 'general', label: 'Base de datos', kind: 'path', def: '~/.valet-dashboard/mailpit/mailpit.db', help: 'Archivo SQLite persistente. Por defecto se guarda junto al panel.' },
  { key: 'MP_DISABLE_WAL', group: 'general', label: 'Desactivar WAL', kind: 'bool', help: 'Necesario si la base está en NFS o Samba.' },
  { key: 'MP_DISABLE_VERSION_CHECK', group: 'general', label: 'Ocultar aviso de versión', kind: 'bool', def: 'true' },
  { key: 'MP_DISABLE_AUTO_VACUUM', group: 'general', label: 'Desactivar auto-vacuum', kind: 'bool' },
  { key: 'MP_COMPRESSION', group: 'general', label: 'Compresión', kind: 'select', def: '1', options: [
    { value: '0', label: '0 · sin compresión' },
    { value: '1', label: '1 · rápida (por defecto)' },
    { value: '2', label: '2 · equilibrada' },
    { value: '3', label: '3 · máxima' }
  ], help: 'Nivel de compresión de los mensajes en la base de datos (0–3).' },
  { key: 'MP_LABEL', group: 'general', label: 'Etiqueta del servidor', kind: 'text', placeholder: 'Desarrollo local' },
  { key: 'MP_TENANT_ID', group: 'general', label: 'Tenant ID', kind: 'text', advanced: true },
  { key: 'MP_MAX_MESSAGES', group: 'general', label: 'Máximo de mensajes', kind: 'number', def: '500', help: '0 desactiva el borrado automático de los más antiguos.' },
  { key: 'MP_MAX_AGE', group: 'general', label: 'Antigüedad máxima', kind: 'duration', placeholder: '36h o 14d', help: 'En horas (h) o días (d). Vacío para no limitar por edad.' },
  { key: 'MP_MAX_MESSAGE_SIZE', group: 'general', label: 'Tamaño máximo (MB)', kind: 'number', def: '50', help: 'Mensajes mayores se rechazan. 0 significa sin límite.' },
  { key: 'MP_USE_MESSAGE_DATES', group: 'general', label: 'Usar fechas del mensaje', kind: 'bool', advanced: true },
  { key: 'MP_IGNORE_DUPLICATE_IDS', group: 'general', label: 'Ignorar Message-ID duplicados', kind: 'bool', advanced: true },
  { key: 'MP_LOG_FILE', group: 'general', label: 'Archivo de registro', kind: 'path', advanced: true },
  { key: 'MP_QUIET', group: 'general', label: 'Modo silencioso', kind: 'bool', advanced: true },
  { key: 'MP_VERBOSE', group: 'general', label: 'Modo detallado', kind: 'bool', advanced: true },

  // UI y API
  { key: 'MP_UI_BIND_ADDR', group: 'ui', label: 'Escucha UI/API', kind: 'text', def: '127.0.0.1:8025', help: 'Formato host:puerto. Usa 127.0.0.1 para no exponer el buzón a la red.' },
  { key: 'MP_ALLOWED_HOSTS', group: 'ui', label: 'Hosts permitidos', kind: 'text', advanced: true, placeholder: 'mail.test,*.test' },
  { key: 'MP_WEBROOT', group: 'ui', label: 'Webroot', kind: 'text', advanced: true, placeholder: '/mailpit/' },
  { key: 'MP_API_CORS', group: 'ui', label: 'CORS de la API', kind: 'text', advanced: true, placeholder: 'https://app.test' },
  { key: 'MP_BLOCK_REMOTE_CSS_AND_FONTS', group: 'ui', label: 'Bloquear CSS y fuentes remotas', kind: 'bool', help: 'Evita peticiones externas al abrir un correo. Puede romper plantillas.' },
  { key: 'MP_ALLOW_INTERNAL_HTTP_REQUESTS', group: 'ui', label: 'Permitir peticiones HTTP internas', kind: 'bool', advanced: true },
  { key: 'MP_DISABLE_LINK_CHECK_RATE_LIMIT', group: 'ui', label: 'Sin límite en link check', kind: 'bool', advanced: true },
  { key: 'MP_ENABLE_SPAMASSASSIN', group: 'ui', label: 'SpamAssassin', kind: 'text', placeholder: '127.0.0.1:783 o postmark', help: 'Dirección de spamd o «postmark» para el servicio alojado. Vacío para desactivarlo.' },
  { key: 'MP_ALLOW_UNTRUSTED_TLS', group: 'ui', label: 'Aceptar TLS no confiable', kind: 'bool', advanced: true, help: 'Solo para link check y capturas contra destinos con certificados propios.' },
  { key: 'MP_DISABLE_HTTP_COMPRESSION', group: 'ui', label: 'Desactivar compresión HTTP', kind: 'bool', advanced: true },
  { key: 'MP_HIDE_DELETE_ALL_BUTTON', group: 'ui', label: 'Ocultar «Vaciar buzón»', kind: 'bool', advanced: true },
  { key: 'MP_SEND_API_AUTH_ACCEPT_ANY', group: 'ui', label: 'Send API acepta cualquier credencial', kind: 'bool', advanced: true },

  // SMTP
  { key: 'MP_SMTP_BIND_ADDR', group: 'smtp', label: 'Escucha SMTP', kind: 'text', def: '127.0.0.1:1025', help: 'Formato host:puerto. Los clientes de correo y Laravel se conectan aquí.' },
  { key: 'MP_SMTP_AUTH_ACCEPT_ANY', group: 'smtp', label: 'Aceptar cualquier credencial', kind: 'bool' },
  { key: 'MP_SMTP_AUTH_ALLOW_INSECURE', group: 'smtp', label: 'Permitir auth sin TLS', kind: 'bool', advanced: true },
  { key: 'MP_SMTP_REQUIRE_STARTTLS', group: 'smtp', label: 'Exigir STARTTLS', kind: 'bool', help: 'Requiere certificado TLS configurado.' },
  { key: 'MP_SMTP_REQUIRE_TLS', group: 'smtp', label: 'Exigir TLS directo', kind: 'bool', advanced: true },
  { key: 'MP_SMTP_STRICT_RFC_HEADERS', group: 'smtp', label: 'Cabeceras RFC estrictas', kind: 'bool', advanced: true },
  { key: 'MP_SMTP_MAX_RECIPIENTS', group: 'smtp', label: 'Máximo de destinatarios', kind: 'number', advanced: true },
  { key: 'MP_SMTP_ALLOWED_RECIPIENTS', group: 'smtp', label: 'Destinatarios permitidos', kind: 'text', advanced: true, placeholder: 'regex o dominio' },
  { key: 'MP_SMTP_IGNORE_REJECTED_RECIPIENTS', group: 'smtp', label: 'Ignorar destinatarios rechazados', kind: 'bool', advanced: true },
  { key: 'MP_SMTP_DISABLE_RDNS', group: 'smtp', label: 'Desactivar rDNS', kind: 'bool', advanced: true },

  // POP3
  { key: 'MP_POP3_BIND_ADDR', group: 'pop3', label: 'Escucha POP3', kind: 'text', def: '127.0.0.1:1110' },

  // Relay / forward
  { key: 'MP_SMTP_RELAY_ALL', group: 'relay', label: 'Relay de todos los mensajes', kind: 'bool', help: 'Reenvía todo el correo al SMTP configurado en el YAML de relay.' },
  { key: 'MP_SMTP_RELAY_MATCHING', group: 'relay', label: 'Relay solo a estos destinatarios', kind: 'text', advanced: true, placeholder: '@ejemplo\\.test$', help: 'Expresión regular que se aplica a los destinatarios. No se puede combinar con «Relay de todos los mensajes».' },
  { key: 'MP_SMTP_RELAY_CONFIG', group: 'relay', label: 'Archivo de relay', kind: 'path', advanced: true },
  { key: 'MP_SMTP_FORWARD_CONFIG', group: 'forward', label: 'Archivo de forward', kind: 'path', advanced: true },

  // Chaos
  { key: 'MP_ENABLE_CHAOS', group: 'chaos', label: 'Activar chaos', kind: 'bool' },
  { key: 'MP_CHAOS_TRIGGERS', group: 'chaos', label: 'Disparadores', kind: 'text', advanced: true, placeholder: 'Sender:451:50,Recipient:451:20', help: 'etapa:código:probabilidad separado por comas. Etapas: Sender, Recipient y Authentication; la probabilidad va de 0 a 100. Rellenarlo activa chaos aunque no marques la casilla.' },

  // Etiquetas
  { key: 'MP_TAG', group: 'tags', label: 'Etiquetas por filtro', kind: 'text', placeholder: 'pedidos=from:.*@tienda.test', help: 'Pares Etiqueta=coincidencia separados por espacios; no aplica una etiqueta a todo. Para varias reglas largas usa el archivo de etiquetas.' },
  { key: 'MP_TAGS_CONFIG', group: 'tags', label: 'Archivo de etiquetas', kind: 'path', advanced: true },
  { key: 'MP_TAGS_TITLE_CASE', group: 'tags', label: 'Etiquetas en Title Case', kind: 'bool', advanced: true },
  { key: 'MP_TAGS_DISABLE', group: 'tags', label: 'Desactivar etiquetas', kind: 'text', advanced: true, placeholder: 'plus-addresses,x-tags', help: 'Lista separada por comas de reglas de auto-etiquetado que se desactivan.' },
  { key: 'MP_TAGS_USERNAME', group: 'tags', label: 'Etiqueta por usuario', kind: 'bool', advanced: true, help: 'Añade una etiqueta con el usuario autenticado que envió el mensaje.' },

  // Métricas
  { key: 'MP_ENABLE_PROMETHEUS', group: 'metrics', label: 'Activar Prometheus', kind: 'text', placeholder: 'true o 0.0.0.0:9090', help: 'true sirve /metrics en el puerto de la UI; una dirección host:puerto abre un servidor aparte.' },

  // Webhook
  { key: 'MP_WEBHOOK_URL', group: 'webhook', label: 'URL del webhook', kind: 'text', placeholder: 'https://app.test/hooks/mailpit' },
  { key: 'MP_WEBHOOK_LIMIT', group: 'webhook', label: 'Límite de webhooks por segundo', kind: 'number', def: '1', advanced: true, help: '1 permite como máximo una petición por segundo; 0 desactiva el límite.' },
  { key: 'MP_WEBHOOK_DELAY', group: 'webhook', label: 'Retardo (segundos)', kind: 'number', def: '0', advanced: true }
]

export const MAILPIT_FIELD_MAP: Record<string, MailpitField> = Object.fromEntries(
  MAILPIT_FIELDS.map((f) => [f.key, f])
)

/** Opciones que gestiona el panel (auth, TLS y rutas de YAML) y no deben editarse a mano. */
export const MAILPIT_MANAGED_KEYS = new Set([
  'MP_UI_AUTH_FILE', 'MP_SMTP_AUTH_FILE', 'MP_POP3_AUTH_FILE', 'MP_SEND_API_AUTH_FILE',
  'MP_UI_TLS_CERT', 'MP_UI_TLS_KEY', 'MP_SMTP_TLS_CERT', 'MP_SMTP_TLS_KEY',
  'MP_POP3_TLS_CERT', 'MP_POP3_TLS_KEY'
])

export interface MailpitAuthConfig {
  enabled: boolean
  user: string
  password: string
}

export interface MailpitTlsConfig {
  enabled: boolean
  selfSigned: boolean
  cert: string
  key: string
}

export interface MailpitAuthGroup {
  ui: MailpitAuthConfig
  smtp: MailpitAuthConfig
  pop3: MailpitAuthConfig
  sendApi: MailpitAuthConfig
}

export interface MailpitConfig {
  options: Record<string, string>
  auth: MailpitAuthGroup
  tls: MailpitTlsConfig
  binarySource: MailpitBinarySource
  systemBinary: string
  startAtLogin: boolean
  githubToken: string
}

export type MailpitAuxKind = 'relay' | 'forward' | 'tags'

export interface MailpitAuxFile {
  kind: MailpitAuxKind
  label: string
  path: string
  content: string
  enabled: boolean
}

export interface MailpitInfo {
  installed: boolean
  running: boolean
  enabled: boolean
  version: string | null
  managedVersion: string | null
  latestVersion: string | null
  binary: string | null
  binarySource: MailpitBinarySource
  systemBinary: string | null
  uiUrl: string
  smtpAddr: string
  pop3Addr: string
  pop3Enabled: boolean
  ports: { ui: number; smtp: number; pop3: number }
  database: string
  configPath: string
  envPath: string
  unitPath: string
  systemdAvailable: boolean
  messages: number | null
  unread: number | null
  databaseSize: number | null
  uptime: string | null
  auth: boolean
  tls: boolean
  warnings: string[]
}

export type MailpitEvent =
  | { type: 'status'; text: string }
  | { type: 'progress'; percent: number; text: string }
  | { type: 'log'; text: string }

export interface MailpitProjectEnvResult {
  site: string
  file: string
  backup: string | null
  changed: string[]
}

export interface MailpitSendmailInfo {
  version: string
  installed: boolean
  enabled: boolean
  fpmFile: string | null
  cliFile: string | null
  sendmailPath: string
}

export interface MailpitApi {
  info(): Promise<MailpitInfo>
  config(): Promise<MailpitConfig>
  save(config: MailpitConfig): Promise<MailpitInfo>
  start(): Promise<MailpitInfo>
  stop(): Promise<MailpitInfo>
  restart(): Promise<MailpitInfo>
  install(): Promise<MailpitInfo>
  useSystem(path: string): Promise<MailpitInfo>
  uninstall(deleteData: boolean): Promise<void>
  logs(lines?: number): Promise<string>
  clearMessages(): Promise<void>
  sendTest(to: string): Promise<void>
  openExternal(): Promise<void>
  auxiliary(): Promise<MailpitAuxFile[]>
  writeAuxiliary(kind: MailpitAuxKind, content: string): Promise<MailpitAuxFile[]>
  configureEnv(site: string): Promise<MailpitProjectEnvResult>
  sendmailInfo(): Promise<MailpitSendmailInfo[]>
  setPhpSendmail(version: string, enable: boolean): Promise<void>
  testPhpMail(version: string, to: string): Promise<void>
  setBounds(rect: { x: number; y: number; width: number; height: number } | null, visible: boolean, url?: string): void
  onEvent(cb: (e: MailpitEvent) => void): () => void
  onShortcut(cb: (key: string) => void): () => void
}

export const MAILPIT_UNIT = 'valet-dashboard-mailpit.service'

/** Aviso compartido: Mailpit no abre POP3 sin credenciales. */
export const MAILPIT_POP3_WARNING = 'POP3 no está disponible: Mailpit exige autenticación POP3 para activarlo.'

/** Valores iniciales de las opciones, aplicando los defaults del esquema. */
export function mailpitDefaultOptions(): Record<string, string> {
  const options: Record<string, string> = {}
  for (const f of MAILPIT_FIELDS) if (f.def) options[f.key] = f.def
  return options
}

/** Convierte el mapa de opciones en pares clave/valor para el editor avanzado. */
export function mailpitOptionEntries(options: Record<string, string>): { key: string; value: string }[] {
  return Object.entries(options)
    .filter(([k]) => !MAILPIT_FIELD_MAP[k] && !MAILPIT_MANAGED_KEYS.has(k))
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key))
}
