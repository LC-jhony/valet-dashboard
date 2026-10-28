import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  MAILPIT_FIELD_MAP, MAILPIT_FIELDS, MAILPIT_MANAGED_KEYS, MAILPIT_UNIT,
  mailpitDefaultOptions, type MailpitAuxFile, type MailpitAuxKind, type MailpitAuthConfig,
  type MailpitConfig, type MailpitTlsConfig
} from '../shared/mailpit'
import { run } from './exec'
import { hashPassword } from './htpasswd'
import { isTrustedBinaryPath, isWithinRoot, resolveWithinRoot } from './safe-path'

export const HOME = homedir()
export const APP_DIR = join(HOME, '.valet-dashboard')
export const MANAGED_BIN = join(APP_DIR, 'bin', 'mailpit')
export const MAILPIT_DATA_DIR = join(APP_DIR, 'mailpit')
export const BACKUP_DIR = join(APP_DIR, 'backups')

export const CONFIG_DIR = join(HOME, '.config', 'valet-dashboard')
export const MAILPIT_CONFIG_DIR = join(CONFIG_DIR, 'mailpit')
export const CONFIG_FILE = join(CONFIG_DIR, 'mailpit.json')
export const ENV_FILE = join(CONFIG_DIR, 'mailpit.env')
export const AUTH_DIR = join(MAILPIT_CONFIG_DIR, 'auth')
export const TLS_DIR = join(MAILPIT_CONFIG_DIR, 'tls')
export const AUX_DIR = join(MAILPIT_CONFIG_DIR, 'yml')
export const UNIT_FILE = join(HOME, '.config', 'systemd', 'user', MAILPIT_UNIT)

export const RESERVED_PORTS: Record<number, string> = {
  53: 'DNS', 67: 'DHCP', 68: 'DHCP', 123: 'NTP', 5353: 'mDNS', 5354: 'DNS seguro'
}

/** Directorios desde los que se acepta un Mailpit «del sistema». */
export const TRUSTED_BIN_ROOTS = [
  '/usr/local/bin', '/usr/local/sbin', '/usr/bin', '/usr/sbin', '/bin', '/sbin', '/snap/bin',
  join(HOME, '.local', 'bin')
]

/**
 * Opciones que apuntan a archivos que el panel lee, escribe o borra. Se confinan
 * a su directorio: así una configuración manipulada no puede convertir el panel
 * en una escritura o un borrado arbitrario.
 */
const PATH_RULES: { key: string; root: string; label: string; url?: boolean }[] = [
  { key: 'MP_DATABASE', root: MAILPIT_DATA_DIR, label: 'The database', url: true },
  { key: 'MP_LOG_FILE', root: MAILPIT_DATA_DIR, label: 'The log file' },
  { key: 'MP_TAGS_CONFIG', root: AUX_DIR, label: 'The tags YAML' },
  { key: 'MP_SMTP_RELAY_CONFIG', root: AUX_DIR, label: 'The relay YAML' },
  { key: 'MP_SMTP_FORWARD_CONFIG', root: AUX_DIR, label: 'The forward YAML' }
]

export const expandHome = (p: string) =>
  p === '~' ? HOME : p.startsWith('~/') ? join(HOME, p.slice(2)) : p

export const nowStamp = () => new Date().toISOString().replace(/[:.]/g, '-')

/** Escribe un archivo privado de forma atómica. */
export async function writePrivate(path: string, content: string, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, content, { mode })
  await chmod(tmp, mode)
  await rename(tmp, path)
}

const emptyAuth = (): MailpitAuthConfig => ({ enabled: false, user: '', password: '' })

const emptyTls = (): MailpitTlsConfig => ({ enabled: false, selfSigned: true, cert: '', key: '' })

export function defaultConfig(): MailpitConfig {
  return {
    options: mailpitDefaultOptions(),
    auth: { ui: emptyAuth(), smtp: emptyAuth(), pop3: emptyAuth(), sendApi: emptyAuth() },
    tls: emptyTls(),
    binarySource: 'managed',
    systemBinary: '',
    startAtLogin: true,
    githubToken: ''
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}

function asAuth(v: unknown): MailpitAuthConfig {
  const r = asRecord(v)
  return {
    enabled: r.enabled === true,
    user: typeof r.user === 'string' ? r.user : '',
    password: typeof r.password === 'string' ? r.password : ''
  }
}

function asTls(v: unknown): MailpitTlsConfig {
  const r = asRecord(v)
  return {
    enabled: r.enabled === true,
    selfSigned: r.selfSigned !== false,
    cert: typeof r.cert === 'string' ? r.cert : '',
    key: typeof r.key === 'string' ? r.key : ''
  }
}

export async function loadConfig(): Promise<MailpitConfig> {
  const base = defaultConfig()
  let raw: unknown = null
  try { raw = JSON.parse(await readFile(CONFIG_FILE, 'utf8')) } catch { /* primer uso */ }
  const r = asRecord(raw)
  const saved = asRecord(r.options)
  const options: Record<string, string> = { ...base.options }
  for (const [k, v] of Object.entries(saved)) {
    if (typeof v === 'string' && /^MP_[A-Z0-9_]+$/.test(k)) options[k] = v
  }
  const auth = asRecord(r.auth)
  return {
    options,
    auth: {
      ui: asAuth(auth.ui),
      smtp: asAuth(auth.smtp),
      pop3: asAuth(auth.pop3),
      sendApi: asAuth(auth.sendApi)
    },
    tls: asTls(r.tls),
    binarySource: r.binarySource === 'system' ? 'system' : 'managed',
    systemBinary: typeof r.systemBinary === 'string' ? r.systemBinary : '',
    startAtLogin: r.startAtLogin !== false,
    githubToken: typeof r.githubToken === 'string' ? r.githubToken : ''
  }
}

/** Valida y normaliza lo que llega del renderer. Lanza un error legible si algo no cuadra. */
export function validateConfig(input: MailpitConfig): MailpitConfig {
  if (!input || typeof input !== 'object') throw new Error('Invalid configuration')
  const base = defaultConfig()
  const rawOptions = asRecord(input.options)
  const options: Record<string, string> = { ...base.options }
  for (const [k, v] of Object.entries(rawOptions)) {
    if (!/^MP_[A-Z0-9_]+$/.test(k)) throw new Error(`Invalid option key: ${k}`)
    if (MAILPIT_MANAGED_KEYS.has(k)) continue
    const value = typeof v === 'string' ? v.trim() : ''
    if (/[\r\n\0]/.test(value)) throw new Error(`Option ${k} cannot contain line breaks`)
    options[k] = value
  }
  for (const f of MAILPIT_FIELDS) {
    const value = options[f.key] ?? ''
    if (!value) continue
    if (f.kind === 'number' && !/^\d+$/.test(value)) {
      throw new Error(`${f.key} must be an integer`)
    }
    if (f.kind === 'bool' && !['true', 'false'].includes(value)) {
      throw new Error(`${f.key} must be true or false`)
    }
    if (f.kind === 'select' && f.options && !f.options.some((o) => o.value === value)) {
      throw new Error(`${f.key} must be one of: ${f.options.map((o) => o.value).join(', ')}`)
    }
    if (f.kind === 'duration' && !/^\d+[hd]$/i.test(value)) {
      throw new Error(`${f.key} must use hours (for example 36h) or days (for example 14d)`)
    }
  }

  for (const rule of PATH_RULES) {
    const value = options[rule.key]?.trim()
    if (!value) continue
    if (rule.url && /^https?:\/\//i.test(value)) continue
    if (!isWithinRoot(rule.root, value)) throw new Error(`${rule.label} must be inside ${rule.root}`)
  }

  const parse = (key: string, fallback: number) => {
    const value = options[key]
    if (!value) return fallback
    const p = parseAddress(value)
    if (!p) throw new Error(`${key} must use host:port format (for example 127.0.0.1:${fallback})`)
    if (RESERVED_PORTS[p.port]) throw new Error(`Port ${p.port} is reserved for ${RESERVED_PORTS[p.port]}`)
    return p.port
  }
  const ui = parse('MP_UI_BIND_ADDR', 8025)
  const smtp = parse('MP_SMTP_BIND_ADDR', 1025)
  const pop3 = parse('MP_POP3_BIND_ADDR', 1110)
  if (new Set([ui, smtp, pop3]).size !== 3) {
    throw new Error('UI, SMTP and POP3 must use different ports')
  }

  const auth = {
    ui: asAuth(input.auth?.ui),
    smtp: asAuth(input.auth?.smtp),
    pop3: asAuth(input.auth?.pop3),
    sendApi: asAuth(input.auth?.sendApi)
  }
  for (const [name, a] of Object.entries(auth)) {
    if (!a.enabled) { a.user = ''; a.password = ''; continue }
    if (!a.user.trim()) throw new Error(`The ${name} authentication needs a user`)
    if (!a.password) throw new Error(`The ${name} authentication needs a password`)
    if (/[\s:\r\n]/.test(a.user)) throw new Error(`The ${name} user cannot contain spaces or colons`)
    if (/[\r\n]/.test(a.password)) throw new Error(`The ${name} password cannot contain line breaks`)
  }

  const tls = asTls(input.tls)
  if ((options.MP_SMTP_REQUIRE_STARTTLS === 'true' || options.MP_SMTP_REQUIRE_TLS === 'true') && !tls.enabled) {
    throw new Error('To require STARTTLS or TLS in SMTP, enable TLS in the TLS tab first')
  }
  if (tls.enabled && !tls.selfSigned) {
    if (!tls.cert.trim() || !tls.key.trim()) throw new Error('Provide the TLS certificate and key, or enable the self-signed certificate')
    for (const p of [tls.cert, tls.key]) if (!existsSync(expandHome(p))) throw new Error(`The TLS file does not exist: ${p}`)
  }

  const systemBinary = expandHome(typeof input.systemBinary === 'string' ? input.systemBinary.trim() : '')
  if (input.binarySource === 'system' && systemBinary) {
    if (!isTrustedBinaryPath(TRUSTED_BIN_ROOTS, systemBinary)) {
      throw new Error(`The system Mailpit must be in a trusted folder (${TRUSTED_BIN_ROOTS.join(', ')})`)
    }
    if (!existsSync(systemBinary)) throw new Error(`The given binary does not exist: ${systemBinary}`)
  }

  return {
    options,
    auth,
    tls,
    binarySource: input.binarySource === 'system' ? 'system' : 'managed',
    systemBinary,
    startAtLogin: input.startAtLogin !== false,
    githubToken: typeof input.githubToken === 'string' ? input.githubToken.trim() : ''
  }
}

export function parseAddress(value: string): { host: string; port: number } | null {
  const m = value.trim().match(/^(\[[0-9a-fA-F:]+\]|[^\s:]+):(\d{1,5})$/)
  if (!m) return null
  const port = Number(m[2])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host: m[1], port }
}

export function configPorts(config: MailpitConfig) {
  return {
    ui: parseAddress(config.options.MP_UI_BIND_ADDR ?? '')?.port ?? 8025,
    smtp: parseAddress(config.options.MP_SMTP_BIND_ADDR ?? '')?.port ?? 1025,
    pop3: parseAddress(config.options.MP_POP3_BIND_ADDR ?? '')?.port ?? 1110
  }
}

export function addressHost(value: string | undefined, fallback = '127.0.0.1') {
  return (value ? parseAddress(value)?.host : null) ?? fallback
}

export const isLoopback = (host: string) =>
  host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'

/** systemd EnvironmentFile: comillas dobles para valores con espacios. */
export function envQuote(value: string): string {
  if (!/[\s"'\\$`]/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`
}

export function mailpitAuthPath(kind: keyof MailpitConfig['auth']): string {
  return join(AUTH_DIR, `${kind}.htpasswd`)
}

async function writeAuth(kind: keyof MailpitConfig['auth'], a: MailpitAuthConfig, path: string) {
  if (!a.enabled) { await rm(path, { force: true }).catch(() => ''); return }
  await writePrivate(path, `${await hashPassword(a.user.trim(), a.password)}\n`, 0o600)
}

export async function generateSelfSigned(): Promise<{ cert: string; key: string }> {
  await mkdir(TLS_DIR, { recursive: true })
  const cert = join(TLS_DIR, 'mailpit.crt')
  const key = join(TLS_DIR, 'mailpit.key')
  if (existsSync(cert) && existsSync(key)) return { cert, key }
  const base = [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '825', '-nodes',
    '-keyout', key, '-out', cert, '-subj', '/CN=localhost'
  ]
  try {
    await run('openssl', [...base, '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'])
  } catch {
    await run('openssl', base)
  }
  await chmod(key, 0o600)
  return { cert, key }
}

/** Aplica auth/TLS y devuelve el mapa de opciones final (con rutas absolutas). */
export async function materializeConfig(config: MailpitConfig): Promise<Record<string, string>> {
  const options: Record<string, string> = { ...config.options }
  for (const key of MAILPIT_MANAGED_KEYS) delete options[key]
  const ports = configPorts(config)

  await mkdir(AUTH_DIR, { recursive: true })
  const setAuth = async (kind: keyof MailpitConfig['auth'], option: string) => {
    const path = mailpitAuthPath(kind)
    await writeAuth(kind, config.auth[kind], path)
    if (config.auth[kind].enabled) options[option] = path
  }
  await setAuth('ui', 'MP_UI_AUTH_FILE')
  await setAuth('smtp', 'MP_SMTP_AUTH_FILE')
  await setAuth('pop3', 'MP_POP3_AUTH_FILE')
  await setAuth('sendApi', 'MP_SEND_API_AUTH_FILE')

  if (config.tls.enabled) {
    const files = config.tls.selfSigned
      ? await generateSelfSigned()
      : { cert: expandHome(config.tls.cert.trim()), key: expandHome(config.tls.key.trim()) }
    options.MP_UI_TLS_CERT = files.cert
    options.MP_UI_TLS_KEY = files.key
    options.MP_SMTP_TLS_CERT = files.cert
    options.MP_SMTP_TLS_KEY = files.key
    options.MP_POP3_TLS_CERT = files.cert
    options.MP_POP3_TLS_KEY = files.key
  }

  // Las rutas del panel siempre son absolutas y coherentes con los puertos.
  if (!options.MP_DATABASE?.trim()) options.MP_DATABASE = join(MAILPIT_DATA_DIR, 'mailpit.db')
  for (const key of ['MP_DATABASE', 'MP_LOG_FILE']) {
    const value = options[key]?.trim()
    if (!value || /^https?:\/\//i.test(value)) continue
    await mkdir(dirname(expandHome(value)), { recursive: true })
  }
  return options
}

export function renderEnv(options: Record<string, string>): string {
  const lines = ['# Generated by Valet Dashboard. Do not edit by hand: use the Mail tab.', '']
  for (const key of Object.keys(options).sort()) {
    const raw = options[key]
    if (raw == null || raw === '') continue
    const value = MAILPIT_FIELD_MAP[key]?.kind === 'path' ? expandHome(raw) : raw
    lines.push(`${key}=${envQuote(value)}`)
  }
  return `${lines.join('\n')}\n`
}

export async function saveConfig(config: MailpitConfig, options: Record<string, string>) {
  await writePrivate(CONFIG_FILE, `${JSON.stringify({ ...config, options }, null, 2)}\n`, 0o600)
}

export async function writeEnvFile(options: Record<string, string>) {
  await writePrivate(ENV_FILE, renderEnv(options), 0o600)
}

/** Escribe la unidad systemd de usuario. */
export async function writeUnit(binary: string) {
  const unit = `[Unit]
Description=Mailpit (Valet Dashboard)
Documentation=https://mailpit.axllent.org/docs/
After=network.target

[Service]
Type=simple
EnvironmentFile=${ENV_FILE}
ExecStart="${binary}"
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`
  await writePrivate(UNIT_FILE, unit, 0o644)
}

export function sha256(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

const AUX: Record<MailpitAuxKind, { option: string; label: string; file: string }> = {
  relay: { option: 'MP_SMTP_RELAY_CONFIG', label: 'Relay SMTP', file: 'relay.yml' },
  forward: { option: 'MP_SMTP_FORWARD_CONFIG', label: 'Forward SMTP', file: 'forward.yml' },
  tags: { option: 'MP_TAGS_CONFIG', label: 'Tags', file: 'tags.yml' }
}

export async function readAuxiliary(config: MailpitConfig): Promise<MailpitAuxFile[]> {
  const out: MailpitAuxFile[] = []
  for (const [kind, meta] of Object.entries(AUX) as [MailpitAuxKind, typeof AUX[MailpitAuxKind]][]) {
    const configured = config.options[meta.option]?.trim()
    const path = configured
      ? await resolveWithinRoot(AUX_DIR, configured, meta.label).catch(() => '')
      : join(AUX_DIR, meta.file)
    let content = ''
    if (path) {
      try { content = await readFile(path, 'utf8') } catch { /* sin archivo */ }
    }
    out.push({ kind, label: meta.label, path: path || expandHome(configured!), content, enabled: Boolean(configured) })
  }
  return out
}

export async function writeAuxiliary(
  config: MailpitConfig, kind: MailpitAuxKind, content: string
): Promise<{ config: MailpitConfig; path: string; previous: { path: string; content: string } | null }> {
  const meta = AUX[kind]
  const configured = config.options[meta.option]?.trim()
  const path = configured
    ? await resolveWithinRoot(AUX_DIR, configured, meta.label)
    : join(AUX_DIR, meta.file)
  const previous = existsSync(path)
    ? { path, content: await readFile(path, 'utf8') }
    : null
  const next: MailpitConfig = {
    ...config,
    options: { ...config.options }
  }
  if (!content.trim()) {
    await rm(path, { force: true })
    delete next.options[meta.option]
  } else {
    await writePrivate(path, content.endsWith('\n') ? content : `${content}\n`, 0o600)
    next.options[meta.option] = path
  }
  return { config: next, path, previous }
}
