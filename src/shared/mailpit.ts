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
  { id: 'general', label: 'General', hint: 'Storage, limits, compression and logging.' },
  { id: 'ui', label: 'Web UI and API', hint: 'Listen address, browser security, CORS and SpamAssassin.' },
  { id: 'smtp', label: 'SMTP', hint: 'Incoming mail server, TLS and recipient lists.' },
  { id: 'pop3', label: 'POP3', hint: 'Optional POP3 server for mail clients.' },
  { id: 'relay', label: 'Relay', hint: 'Forward messages to a real SMTP through a YAML file.' },
  { id: 'forward', label: 'Forward', hint: 'Automatic copy of messages to another SMTP.' },
  { id: 'chaos', label: 'Chaos', hint: 'Simulate failures and latency to test applications.' },
  { id: 'tags', label: 'Tags', hint: 'Automatic classification by X-Tag rules and sender.' },
  { id: 'metrics', label: 'Prometheus', hint: 'Server metrics at /metrics.' },
  { id: 'webhook', label: 'Webhook', hint: 'HTTP notification when a message arrives.' }
]

export const MAILPIT_FIELDS: MailpitField[] = [
  // General
  { key: 'MP_DATABASE', group: 'general', label: 'Database', kind: 'path', def: '~/.valet-dashboard/mailpit/mailpit.db', help: 'Persistent SQLite file. By default it is stored next to the panel.' },
  { key: 'MP_DISABLE_WAL', group: 'general', label: 'Disable WAL', kind: 'bool', help: 'Needed if the database is on NFS or Samba.' },
  { key: 'MP_DISABLE_VERSION_CHECK', group: 'general', label: 'Hide version notice', kind: 'bool', def: 'true' },
  { key: 'MP_DISABLE_AUTO_VACUUM', group: 'general', label: 'Disable auto-vacuum', kind: 'bool' },
  { key: 'MP_COMPRESSION', group: 'general', label: 'Compression', kind: 'select', def: '1', options: [
    { value: '0', label: '0 · no compression' },
    { value: '1', label: '1 · fast (default)' },
    { value: '2', label: '2 · balanced' },
    { value: '3', label: '3 · maximum' }
  ], help: 'Message compression level in the database (0–3).' },
  { key: 'MP_LABEL', group: 'general', label: 'Server label', kind: 'text', placeholder: 'Local development' },
  { key: 'MP_TENANT_ID', group: 'general', label: 'Tenant ID', kind: 'text', advanced: true },
  { key: 'MP_MAX_MESSAGES', group: 'general', label: 'Maximum messages', kind: 'number', def: '500', help: '0 disables automatic deletion of the oldest messages.' },
  { key: 'MP_MAX_AGE', group: 'general', label: 'Maximum age', kind: 'duration', placeholder: '36h or 14d', help: 'In hours (h) or days (d). Empty to set no age limit.' },
  { key: 'MP_MAX_MESSAGE_SIZE', group: 'general', label: 'Maximum size (MB)', kind: 'number', def: '50', help: 'Larger messages are rejected. 0 means no limit.' },
  { key: 'MP_USE_MESSAGE_DATES', group: 'general', label: 'Use message dates', kind: 'bool', advanced: true },
  { key: 'MP_IGNORE_DUPLICATE_IDS', group: 'general', label: 'Ignore duplicate Message-IDs', kind: 'bool', advanced: true },
  { key: 'MP_LOG_FILE', group: 'general', label: 'Log file', kind: 'path', advanced: true },
  { key: 'MP_QUIET', group: 'general', label: 'Quiet mode', kind: 'bool', advanced: true },
  { key: 'MP_VERBOSE', group: 'general', label: 'Verbose mode', kind: 'bool', advanced: true },

  // UI y API
  { key: 'MP_UI_BIND_ADDR', group: 'ui', label: 'UI/API listen address', kind: 'text', def: '127.0.0.1:8025', help: 'host:port format. Use 127.0.0.1 to avoid exposing the mailbox to the network.' },
  { key: 'MP_ALLOWED_HOSTS', group: 'ui', label: 'Allowed hosts', kind: 'text', advanced: true, placeholder: 'mail.test,*.test' },
  { key: 'MP_WEBROOT', group: 'ui', label: 'Webroot', kind: 'text', advanced: true, placeholder: '/mailpit/' },
  { key: 'MP_API_CORS', group: 'ui', label: 'API CORS', kind: 'text', advanced: true, placeholder: 'https://app.test' },
  { key: 'MP_BLOCK_REMOTE_CSS_AND_FONTS', group: 'ui', label: 'Block remote CSS and fonts', kind: 'bool', help: 'Prevents external requests when opening a mail. It can break templates.' },
  { key: 'MP_ALLOW_INTERNAL_HTTP_REQUESTS', group: 'ui', label: 'Allow internal HTTP requests', kind: 'bool', advanced: true },
  { key: 'MP_DISABLE_LINK_CHECK_RATE_LIMIT', group: 'ui', label: 'No link check rate limit', kind: 'bool', advanced: true },
  { key: 'MP_ENABLE_SPAMASSASSIN', group: 'ui', label: 'SpamAssassin', kind: 'text', placeholder: '127.0.0.1:783 or postmark', help: 'spamd address, or “postmark” for the hosted service. Empty to disable it.' },
  { key: 'MP_ALLOW_UNTRUSTED_TLS', group: 'ui', label: 'Accept untrusted TLS', kind: 'bool', advanced: true, help: 'Only for link checks and screenshots against targets with their own certificates.' },
  { key: 'MP_DISABLE_HTTP_COMPRESSION', group: 'ui', label: 'Disable HTTP compression', kind: 'bool', advanced: true },
  { key: 'MP_HIDE_DELETE_ALL_BUTTON', group: 'ui', label: 'Hide “Empty mailbox”', kind: 'bool', advanced: true },
  { key: 'MP_SEND_API_AUTH_ACCEPT_ANY', group: 'ui', label: 'Send API accepts any credentials', kind: 'bool', advanced: true },

  // SMTP
  { key: 'MP_SMTP_BIND_ADDR', group: 'smtp', label: 'SMTP listen address', kind: 'text', def: '127.0.0.1:1025', help: 'host:port format. Mail clients and Laravel connect here.' },
  { key: 'MP_SMTP_AUTH_ACCEPT_ANY', group: 'smtp', label: 'Accept any credentials', kind: 'bool' },
  { key: 'MP_SMTP_AUTH_ALLOW_INSECURE', group: 'smtp', label: 'Allow auth without TLS', kind: 'bool', advanced: true },
  { key: 'MP_SMTP_REQUIRE_STARTTLS', group: 'smtp', label: 'Require STARTTLS', kind: 'bool', help: 'Requires a configured TLS certificate.' },
  { key: 'MP_SMTP_REQUIRE_TLS', group: 'smtp', label: 'Require direct TLS', kind: 'bool', advanced: true },
  { key: 'MP_SMTP_STRICT_RFC_HEADERS', group: 'smtp', label: 'Strict RFC headers', kind: 'bool', advanced: true },
  { key: 'MP_SMTP_MAX_RECIPIENTS', group: 'smtp', label: 'Maximum recipients', kind: 'number', advanced: true },
  { key: 'MP_SMTP_ALLOWED_RECIPIENTS', group: 'smtp', label: 'Allowed recipients', kind: 'text', advanced: true, placeholder: 'regex or domain' },
  { key: 'MP_SMTP_IGNORE_REJECTED_RECIPIENTS', group: 'smtp', label: 'Ignore rejected recipients', kind: 'bool', advanced: true },
  { key: 'MP_SMTP_DISABLE_RDNS', group: 'smtp', label: 'Disable rDNS', kind: 'bool', advanced: true },

  // POP3
  { key: 'MP_POP3_BIND_ADDR', group: 'pop3', label: 'POP3 listen address', kind: 'text', def: '127.0.0.1:1110' },

  // Relay / forward
  { key: 'MP_SMTP_RELAY_ALL', group: 'relay', label: 'Relay all messages', kind: 'bool', help: 'Forwards all mail to the SMTP configured in the relay YAML.' },
  { key: 'MP_SMTP_RELAY_MATCHING', group: 'relay', label: 'Relay only to these recipients', kind: 'text', advanced: true, placeholder: '@example\\.test$', help: 'Regular expression applied to recipients. It cannot be combined with “Relay all messages”.' },
  { key: 'MP_SMTP_RELAY_CONFIG', group: 'relay', label: 'Relay file', kind: 'path', advanced: true },
  { key: 'MP_SMTP_FORWARD_CONFIG', group: 'forward', label: 'Forward file', kind: 'path', advanced: true },

  // Chaos
  { key: 'MP_ENABLE_CHAOS', group: 'chaos', label: 'Enable chaos', kind: 'bool' },
  { key: 'MP_CHAOS_TRIGGERS', group: 'chaos', label: 'Triggers', kind: 'text', advanced: true, placeholder: 'Sender:451:50,Recipient:451:20', help: 'stage:code:probability separated by commas. Stages: Sender, Recipient and Authentication; probability goes from 0 to 100. Filling it in enables chaos even if the box is unchecked.' },

  // Etiquetas
  { key: 'MP_TAG', group: 'tags', label: 'Tags by filter', kind: 'text', placeholder: 'orders=from:.*@shop.test', help: 'Tag=match pairs separated by spaces; it does not tag everything. For several long rules use the tags file.' },
  { key: 'MP_TAGS_CONFIG', group: 'tags', label: 'Tags file', kind: 'path', advanced: true },
  { key: 'MP_TAGS_TITLE_CASE', group: 'tags', label: 'Tags in Title Case', kind: 'bool', advanced: true },
  { key: 'MP_TAGS_DISABLE', group: 'tags', label: 'Disable tags', kind: 'text', advanced: true, placeholder: 'plus-addresses,x-tags', help: 'Comma-separated list of auto-tagging rules to disable.' },
  { key: 'MP_TAGS_USERNAME', group: 'tags', label: 'Tag by user', kind: 'bool', advanced: true, help: 'Adds a tag with the authenticated user who sent the message.' },

  // Métricas
  { key: 'MP_ENABLE_PROMETHEUS', group: 'metrics', label: 'Enable Prometheus', kind: 'text', placeholder: 'true or 0.0.0.0:9090', help: 'true serves /metrics on the UI port; a host:port address opens a separate server.' },

  // Webhook
  { key: 'MP_WEBHOOK_URL', group: 'webhook', label: 'Webhook URL', kind: 'text', placeholder: 'https://app.test/hooks/mailpit' },
  { key: 'MP_WEBHOOK_LIMIT', group: 'webhook', label: 'Webhook limit per second', kind: 'number', def: '1', advanced: true, help: '1 allows at most one request per second; 0 disables the limit.' },
  { key: 'MP_WEBHOOK_DELAY', group: 'webhook', label: 'Delay (seconds)', kind: 'number', def: '0', advanced: true }
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
export const MAILPIT_POP3_WARNING = 'POP3 is not available: Mailpit requires POP3 authentication to enable it.'

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
