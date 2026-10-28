import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { shell } from 'electron'
import type {
  MailpitAuxFile, MailpitAuxKind, MailpitConfig, MailpitEvent, MailpitInfo
} from '../shared/mailpit'
import { MAILPIT_POP3_WARNING, MAILPIT_UNIT } from '../shared/mailpit'
import { run, env as execEnv } from './exec'
import {
  CONFIG_FILE, ENV_FILE, MANAGED_BIN, MAILPIT_DATA_DIR, TRUSTED_BIN_ROOTS, UNIT_FILE,
  addressHost, configPorts, defaultConfig, expandHome, isLoopback, loadConfig, materializeConfig,
  readAuxiliary, saveConfig, sha256, validateConfig, writeAuxiliary as writeAuxFile,
  writeEnvFile, writePrivate, writeUnit
} from './mailpit-config'
import { isTrustedBinaryPath, resolveWithinRoot, UnsafePathError } from './safe-path'

export { CONFIG_FILE, ENV_FILE, MANAGED_BIN, UNIT_FILE } from './mailpit-config'

const HOME = homedir()
const BIN_DIR = join(HOME, '.valet-dashboard', 'bin')
const PREV_BIN = join(BIN_DIR, 'mailpit.prev')

type Emit = (e: MailpitEvent) => void

interface ReleaseAsset { name: string; browser_download_url: string; digest?: string; size: number }
interface Release { tag_name: string; assets: ReleaseAsset[] }
let releaseCache: { at: number; release: Release } | null = null
let releaseFailureAt = 0
const RELEASE_TTL = 6 * 3600_000
const RELEASE_RETRY = 5 * 60_000

const SYSTEM_PATH = ['/usr/local/bin', '/usr/bin', '/bin', '/snap/bin', join(HOME, '.local', 'bin')]

/** systemd de usuario disponible en esta sesión. */
export async function systemdAvailable(): Promise<boolean> {
  const out = await run('systemctl', ['--user', 'show-environment'], true)
  return out.includes('PATH=') || out.includes('LANG=')
}

export async function unitActive(): Promise<boolean> {
  return (await run('systemctl', ['--user', 'is-active', MAILPIT_UNIT], true)).trim() === 'active'
}

export async function unitEnabled(): Promise<boolean> {
  return (await run('systemctl', ['--user', 'is-enabled', MAILPIT_UNIT], true)).trim() === 'enabled'
}

export function detectSystemBinary(): string | null {
  const dirs = [...(execEnv.PATH ?? '').split(':'), ...SYSTEM_PATH].filter(Boolean)
  for (const dir of dirs) {
    const p = join(dir, 'mailpit')
    if (existsSync(p)) return p
  }
  return null
}

export async function binaryVersion(binary: string | null): Promise<string | null> {
  if (!binary) return null
  const out = await run(binary, ['version'], true)
  const m = out.match(/v?(\d+\.\d+\.\d+)/)
  return m ? `v${m[1]}` : null
}

export async function resolveBinary(config: MailpitConfig): Promise<{ binary: string | null; source: 'managed' | 'system'; system: string | null }> {
  const system = detectSystemBinary()
  if (config.binarySource === 'system') {
    const chosen = config.systemBinary
      && isTrustedBinaryPath(TRUSTED_BIN_ROOTS, config.systemBinary)
      && existsSync(config.systemBinary)
      ? config.systemBinary
      : system
    if (chosen) return { binary: chosen, source: 'system', system }
  }
  if (existsSync(MANAGED_BIN)) return { binary: MANAGED_BIN, source: 'managed', system }
  if (system) return { binary: system, source: 'system', system }
  return { binary: null, source: config.binarySource, system }
}

function clientHost(addr: string | undefined): string {
  const host = addressHost(addr)
  if (host === '0.0.0.0' || host === '[::]' || host === '::') return '127.0.0.1'
  return host === '[::1]' ? '::1' : host.replace(/^\[|\]$/g, '')
}

export function uiUrl(config: MailpitConfig): string {
  const ports = configPorts(config)
  const scheme = config.tls.enabled ? 'https' : 'http'
  const host = clientHost(config.options.MP_UI_BIND_ADDR)
  const shown = host.includes(':') ? `[${host}]` : host
  return `${scheme}://${shown}:${ports.ui}`
}

interface ApiResult { status: number; body: string }

function apiRequest(config: MailpitConfig, path: string, method = 'GET', body?: unknown): Promise<ApiResult> {
  const ports = configPorts(config)
  const secure = config.tls.enabled
  const auth = config.auth.ui
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth.enabled) {
    headers.Authorization = `Basic ${Buffer.from(`${auth.user}:${auth.password}`).toString('base64')}`
  }
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  if (payload) headers['Content-Length'] = String(payload.length)
  const options: RequestOptions = {
    host: clientHost(config.options.MP_UI_BIND_ADDR),
    port: ports.ui,
    path,
    method,
    headers,
    timeout: 5000,
    rejectUnauthorized: !config.tls.selfSigned
  }
  return new Promise((resolve, reject) => {
    const req = (secure ? httpsRequest : httpRequest)(options, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    req.on('timeout', () => req.destroy(new Error('Mailpit did not respond in time')))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

export async function health(config: MailpitConfig): Promise<boolean> {
  try {
    const r = await apiRequest(config, '/livez')
    return r.status >= 200 && r.status < 300
  } catch { return false }
}

interface ApiInfo {
  Version?: string
  Database?: string
  DatabaseSize?: number
  Messages?: number
  Unread?: number
  RuntimeStats?: { Uptime?: number }
}

async function apiInfo(config: MailpitConfig): Promise<ApiInfo | null> {
  try {
    const r = await apiRequest(config, '/api/v1/info')
    if (r.status < 200 || r.status >= 300) return null
    return JSON.parse(r.body) as ApiInfo
  } catch { return null }
}

/** Número de mensajes almacenados; null si Mailpit no responde. */
export async function messageCount(): Promise<number | null> {
  return (await apiInfo(await loadConfig()))?.Messages ?? null
}

function humanUptime(seconds: number | undefined): string | null {
  if (!seconds || seconds < 1) return null
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d) return `${d} d ${h} h`
  if (h) return `${h} h ${m} min`
  return `${m} min`
}

export async function getInfo(): Promise<MailpitInfo> {
  const config = await loadConfig()
  const ports = configPorts(config)
  const { binary, source, system } = await resolveBinary(config)
  const running = await unitActive()
  const enabled = await unitEnabled()
  const systemd = await systemdAvailable()
  const [managedVersion, systemVersion, live, released] = await Promise.all([
    binaryVersion(existsSync(MANAGED_BIN) ? MANAGED_BIN : null),
    binaryVersion(system),
    running ? apiInfo(config) : Promise.resolve(null),
    latestVersion(config).catch(() => null)
  ])
  const actualVersion = live?.Version ?? (binary ? await binaryVersion(binary) : null)
  const warnings: string[] = []
  if (!systemd) warnings.push('systemctl --user is not available in this session; Mailpit cannot run as a user service.')
  if (!binary) warnings.push('There is no Mailpit binary. Install it from this panel.')
  if (binary && !running) warnings.push('Mailpit is installed but stopped. Start it to capture mail.')
  if (!isLoopback(addressHost(config.options.MP_UI_BIND_ADDR))) warnings.push('The Mailpit UI listens outside localhost; the mailbox is exposed to the network.')
  if (!isLoopback(addressHost(config.options.MP_SMTP_BIND_ADDR))) warnings.push('SMTP listens outside localhost; anyone on the network could send mail.')
  if (config.options.MP_ENABLE_SPAMASSASSIN?.trim()) {
    warnings.push(`SpamAssassin is active (${config.options.MP_ENABLE_SPAMASSASSIN}); check that it responds.`)
  }
  if (!config.auth.pop3.enabled) {
    warnings.push(MAILPIT_POP3_WARNING)
  }
  if (actualVersion && released && actualVersion !== released) warnings.push(`A new Mailpit version is available: ${released} (installed ${actualVersion}).`)

  return {
    installed: Boolean(binary),
    running,
    enabled,
    version: actualVersion,
    managedVersion,
    latestVersion: released,
    binary,
    binarySource: source,
    systemBinary: system,
    uiUrl: uiUrl(config),
    smtpAddr: config.options.MP_SMTP_BIND_ADDR || '127.0.0.1:1025',
    pop3Addr: config.options.MP_POP3_BIND_ADDR || '127.0.0.1:1110',
    pop3Enabled: config.auth.pop3.enabled,
    ports,
    database: expandHome(config.options.MP_DATABASE || join(MAILPIT_DATA_DIR, 'mailpit.db')),
    configPath: CONFIG_FILE,
    envPath: ENV_FILE,
    unitPath: UNIT_FILE,
    systemdAvailable: systemd,
    messages: live?.Messages ?? null,
    unread: live?.Unread ?? null,
    databaseSize: live?.DatabaseSize ?? null,
    uptime: humanUptime(live?.RuntimeStats?.Uptime),
    auth: config.auth.ui.enabled,
    tls: config.tls.enabled,
    warnings
  }
}

async function applyConfig(config: MailpitConfig): Promise<{ config: MailpitConfig; options: Record<string, string>; binary: string | null }> {
  const normalized = validateConfig(config)
  const options = await materializeConfig(normalized)
  const { binary } = await resolveBinary(normalized)
  await saveConfig(normalized, normalized.options)
  await writeEnvFile(options)
  if (binary) {
    await writeUnit(binary)
    await run('systemctl', ['--user', 'daemon-reload'], true)
  }
  return { config: normalized, options, binary }
}

async function waitHealth(config: MailpitConfig, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await health(config)) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

async function startUnit(config: MailpitConfig, enable: boolean) {
  if (!(await systemdAvailable())) throw new Error('systemctl --user is not available; Mailpit cannot be started as a service')
  if (enable) await run('systemctl', ['--user', 'enable', MAILPIT_UNIT])
  else await run('systemctl', ['--user', 'disable', MAILPIT_UNIT], true)
  await run('systemctl', ['--user', 'restart', MAILPIT_UNIT])
  if (!(await waitHealth(config))) {
    const logs = await journal(40)
    throw new Error(`Mailpit did not come up healthy. Check the log.\n${logs}`)
  }
}

async function journal(lines = 200): Promise<string> {
  return run('journalctl', ['--user', '-u', MAILPIT_UNIT, '-n', String(lines), '--no-pager', '-o', 'cat'], true)
}

export async function install(emit: Emit = () => {}): Promise<MailpitInfo> {
  const config = await loadConfig()
  const release = await latestRelease(config)
  const asset = release.assets.find((a) => a.name === `mailpit-linux-${assetArch()}.tar.gz`)
  if (!asset) throw new Error(`Release ${release.tag_name} has no binary for ${process.arch}`)

  emit({ type: 'status', text: `Downloading Mailpit ${release.tag_name}…` })
  const data = await download(asset, (percent) => emit({ type: 'progress', percent, text: 'Downloading Mailpit' }))
  emit({ type: 'status', text: 'Verifying SHA-256…' })
  const expected = asset.digest?.replace(/^sha256:/i, '').toLowerCase()
  if (expected) {
    const actual = sha256(data)
    if (actual !== expected) throw new Error(`SHA-256 verification failed (expected ${expected}, got ${actual})`)
  } else {
    emit({ type: 'log', text: 'The release does not publish a digest; skipping SHA-256 verification.\n' })
  }

  emit({ type: 'status', text: 'Extracting the binary…' })
  await mkdir(BIN_DIR, { recursive: true })
  if (existsSync(MANAGED_BIN)) await copyFile(MANAGED_BIN, PREV_BIN)
  const work = join(tmpdir(), `mailpit-${process.pid}-${Date.now()}`)
  await mkdir(work, { recursive: true })
  try {
    const tgz = join(work, 'mailpit.tar.gz')
    await writeFile(tgz, data)
    await run('tar', ['-xzf', tgz, '-C', work])
    const found = await findFile(work, 'mailpit')
    if (!found) throw new Error('The downloaded file does not contain the mailpit binary')
    await chmod(found, 0o755)
    await copyFile(found, MANAGED_BIN)
    await chmod(MANAGED_BIN, 0o755)
  } catch (e) {
    if (existsSync(PREV_BIN)) await copyFile(PREV_BIN, MANAGED_BIN).catch(() => '')
    throw e
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => '')
  }

  const wasRunning = await unitActive()
  const next: MailpitConfig = { ...config, binarySource: 'managed' }
  emit({ type: 'status', text: 'Applying configuration…' })
  await applyConfig(next)
  if (wasRunning || config.startAtLogin) {
    emit({ type: 'status', text: 'Starting Mailpit…' })
    try {
      await startUnit(next, config.startAtLogin)
    } catch (e) {
      if (existsSync(PREV_BIN)) {
        await copyFile(PREV_BIN, MANAGED_BIN).catch(() => '')
        await startUnit(next, config.startAtLogin).catch(() => '')
      }
      throw e
    }
  }
  emit({ type: 'status', text: 'Mailpit listo' })
  return getInfo()
}

async function findFile(dir: string, name: string): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return p
    if (entry.isDirectory()) {
      const nested = await findFile(p, name)
      if (nested) return nested
    }
  }
  return null
}

function assetArch(): string {
  if (process.arch === 'x64') return 'amd64'
  if (process.arch === 'arm64') return 'arm64'
  if (process.arch === 'ia32') return '386'
  return 'arm'
}

async function latestRelease(config: MailpitConfig): Promise<Release> {
  if (releaseCache && Date.now() - releaseCache.at < RELEASE_TTL) return releaseCache.release
  if (releaseFailureAt && Date.now() - releaseFailureAt < RELEASE_RETRY) {
    throw new Error('GitHub could not be queried a moment ago; it will be retried in a few minutes.')
  }
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'valet-dashboard'
  }
  if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`
  let res: Response
  try {
    res = await fetch('https://api.github.com/repos/axllent/mailpit/releases/latest', {
      headers,
      signal: AbortSignal.timeout(8000)
    })
  } catch (e) {
    releaseFailureAt = Date.now()
    throw e
  }
  if (!res.ok) {
    releaseFailureAt = Date.now()
    throw new Error(`GitHub responded ${res.status}. Set a token if you have hit the request limit.`)
  }
  const release = await res.json() as Release
  releaseCache = { at: Date.now(), release }
  releaseFailureAt = 0
  return release
}

async function latestVersion(config: MailpitConfig): Promise<string | null> {
  try { return (await latestRelease(config)).tag_name } catch { return null }
}

async function download(asset: ReleaseAsset, onProgress: (percent: number) => void): Promise<Buffer> {
  const res = await fetch(asset.browser_download_url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Could not download Mailpit (${res.status})`)
  const total = Number(res.headers.get('content-length')) || asset.size || 0
  const chunks: Uint8Array[] = []
  let received = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    received += value.length
    if (total > 0) onProgress(Math.min(100, Math.round((received / total) * 100)))
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)))
}

export async function save(input: MailpitConfig): Promise<MailpitInfo> {
  const previous = await loadConfig()
  const wasRunning = await unitActive()
  const applied = await applyConfig(input)
  if (wasRunning && applied.binary) {
    try {
      await startUnit(applied.config, applied.config.startAtLogin)
    } catch (e) {
      await applyConfig(previous).catch(() => '')
      await startUnit(previous, previous.startAtLogin).catch(() => '')
      throw e
    }
  } else if (applied.binary) {
    if (applied.config.startAtLogin) await run('systemctl', ['--user', 'enable', MAILPIT_UNIT], true)
    else await run('systemctl', ['--user', 'disable', MAILPIT_UNIT], true)
  }
  return getInfo()
}

export async function start(): Promise<MailpitInfo> {
  const config = await loadConfig()
  const applied = await applyConfig(config)
  if (!applied.binary) throw new Error('Install Mailpit before starting it')
  await startUnit(applied.config, applied.config.startAtLogin)
  return getInfo()
}

export async function stop(): Promise<MailpitInfo> {
  await run('systemctl', ['--user', 'stop', MAILPIT_UNIT], true)
  return getInfo()
}

export async function restart(): Promise<MailpitInfo> {
  const config = await loadConfig()
  const applied = await applyConfig(config)
  if (!applied.binary) throw new Error('Install Mailpit before restarting it')
  await startUnit(applied.config, applied.config.startAtLogin)
  return getInfo()
}

export async function useSystem(path: string): Promise<MailpitInfo> {
  if (!path || !existsSync(path)) throw new Error('The system Mailpit path does not exist')
  if (!isTrustedBinaryPath(TRUSTED_BIN_ROOTS, path)) {
    throw new Error(`Only a Mailpit installed in a system folder is accepted (${TRUSTED_BIN_ROOTS.join(', ')})`)
  }
  const resolved = await realpath(path)
  const info = await stat(resolved)
  if (!info.isFile() || (info.mode & 0o111) === 0) throw new Error('The given file is not executable')
  if (!(await binaryVersion(resolved))) throw new Error('The given file does not look like a runnable Mailpit binary')
  const config = await loadConfig()
  return save({ ...config, binarySource: 'system', systemBinary: resolved })
}

export async function uninstall(deleteData: boolean): Promise<void> {
  const config = await loadConfig()
  await run('systemctl', ['--user', 'stop', MAILPIT_UNIT], true)
  await run('systemctl', ['--user', 'disable', MAILPIT_UNIT], true)
  await rm(UNIT_FILE, { force: true })
  await run('systemctl', ['--user', 'daemon-reload'], true)
  await rm(MANAGED_BIN, { force: true })
  await rm(PREV_BIN, { force: true })
  if (!deleteData) return
  const raw = config.options.MP_DATABASE || join(MAILPIT_DATA_DIR, 'mailpit.db')
  if (/^https?:\/\//i.test(raw)) return
  let db: string | null = null
  try {
    db = await resolveWithinRoot(MAILPIT_DATA_DIR, raw, 'The database')
  } catch (e) {
    if (!(e instanceof UnsafePathError)) throw e
    // La base apunta fuera del directorio del panel: no se borra.
  }
  if (db) for (const suffix of ['', '-wal', '-shm']) await rm(`${db}${suffix}`, { force: true })
  await rm(MAILPIT_DATA_DIR, { recursive: true, force: true })
}

export async function logs(lines = 200): Promise<string> {
  const config = await loadConfig()
  const file = config.options.MP_LOG_FILE?.trim()
  if (file) {
    try {
      const safe = await resolveWithinRoot(MAILPIT_DATA_DIR, file, 'The log file')
      const content = await readFile(safe, 'utf8')
      return content.split('\n').slice(-lines).join('\n')
    } catch { /* cae a journalctl */ }
  }
  return journal(lines)
}

export async function clearMessages(): Promise<void> {
  const config = await loadConfig()
  const r = await apiRequest(config, '/api/v1/messages', 'DELETE')
  if (r.status < 200 || r.status >= 300) throw new Error(`Mailpit rejected the purge (${r.status})`)
}

export async function sendTest(to: string): Promise<void> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Invalid email address')
  const config = await loadConfig()
  const r = await apiRequest(config, '/api/v1/send', 'POST', {
    From: { Email: 'valet-dashboard@localhost', Name: 'Valet Dashboard' },
    To: [{ Email: to }],
    Subject: 'Valet Dashboard test mail',
    Text: 'If you see this message, Mailpit is capturing mail correctly.'
  })
  if (r.status < 200 || r.status >= 300) throw new Error(`Mailpit rejected the send (${r.status}): ${r.body.slice(0, 200)}`)
}

export async function openExternal(): Promise<void> {
  const config = await loadConfig()
  await shell.openExternal(uiUrl(config))
}

export async function auxiliary(): Promise<MailpitAuxFile[]> {
  return readAuxiliary(await loadConfig())
}

export async function writeAuxiliary(kind: MailpitAuxKind, content: string): Promise<MailpitAuxFile[]> {
  const config = await loadConfig()
  const previousEnv = await readFile(ENV_FILE, 'utf8').catch(() => '')
  const wasRunning = await unitActive()
  const result = await writeAuxFile(config, kind, content)
  const next = validateConfig(result.config)
  const options = await materializeConfig(next)
  const binary = (await resolveBinary(next)).binary
  if (!binary) throw new Error('There is no Mailpit binary to apply the change')
  await saveConfig(next, next.options)
  await writeEnvFile(options)
  await writeUnit(binary)
  await run('systemctl', ['--user', 'daemon-reload'], true)
  if (wasRunning) {
    try {
      await startUnit(next, next.startAtLogin)
    } catch (e) {
      await saveConfig(config, config.options)
      await writeEnvFile(await materializeConfig(config))
      const previousBinary = (await resolveBinary(config)).binary
      if (previousBinary) await writeUnit(previousBinary)
      if (result.previous) await writePrivate(result.previous.path, result.previous.content, 0o600)
      else await rm(result.path, { force: true }).catch(() => '')
      if (previousEnv) await writePrivate(ENV_FILE, previousEnv, 0o600)
      await startUnit(config, config.startAtLogin).catch(() => '')
      throw e
    }
  }
  return readAuxiliary(next)
}

/** Configuración por defecto, compartida con los diálogos de integración. */
export { defaultConfig }
