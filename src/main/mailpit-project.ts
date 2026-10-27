import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { MailpitProjectEnvResult, MailpitSendmailInfo } from '../shared/mailpit'
import { phpInfo, listSites } from './valet'
import { run, runInput, sudo } from './exec'
import {
  configPorts, expandHome, loadConfig, nowStamp, writePrivate
} from './mailpit-config'
import { messageCount, resolveBinary } from './mailpit'

const HOME = homedir()
const BACKUP_ROOT = join(HOME, '.valet-dashboard', 'backups')
const SENDMAIL_STATE = join(HOME, '.config', 'valet-dashboard', 'php-sendmail.json')
const SENDMAIL_CMD = 'sendmail'

interface SendmailState {
  [version: string]: { fpm: string | null; cli: string | null }
}

async function loadSendmailState(): Promise<SendmailState> {
  try {
    const raw: unknown = JSON.parse(await readFile(SENDMAIL_STATE, 'utf8'))
    return raw && typeof raw === 'object' ? raw as SendmailState : {}
  } catch { return {} }
}

async function saveSendmailState(state: SendmailState) {
  await writePrivate(SENDMAIL_STATE, `${JSON.stringify(state, null, 2)}\n`, 0o600)
}

function envValue(value: string): string {
  return /[\s#"'`]/.test(value) ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value
}

function setKey(source: string, key: string, value: string): { text: string; changed: boolean } {
  const line = `${key}=${envValue(value)}`
  const re = new RegExp(`^(\\s*)${key}\\s*=.*$`, 'm')
  if (re.test(source)) {
    const next = source.replace(re, line)
    return { text: next, changed: next !== source }
  }
  const sep = source === '' || source.endsWith('\n') ? '' : '\n'
  return { text: `${source}${sep}${line}\n`, changed: true }
}

function hasKey(source: string, key: string): boolean {
  return new RegExp(`^\\s*${key}\\s*=`, 'm').test(source)
}

/** Escribe la configuración SMTP de Mailpit en el .env de un sitio Laravel. */
export async function configureEnv(siteName: string): Promise<MailpitProjectEnvResult> {
  if (typeof siteName !== 'string' || !siteName.trim()) throw new Error('Elige un sitio')
  const sites = await listSites()
  const site = sites.find((s) => s.name === siteName)
  if (!site) throw new Error(`Sitio desconocido: ${siteName}`)
  const file = join(site.path, '.env')
  let original: string | null = null
  if (existsSync(file)) {
    original = await readFile(file, 'utf8')
  } else {
    const example = join(site.path, '.env.example')
    if (!existsSync(example)) {
      throw new Error(`No existe .env ni .env.example en ${site.path}`)
    }
    original = await readFile(example, 'utf8')
  }

  const config = await loadConfig()
  const ports = configPorts(config)
  const smtpAuth = config.auth.smtp
  const tls = config.tls.enabled
  const directTls = tls && config.options.MP_SMTP_REQUIRE_TLS === 'true'

  let text = original
  const changed: string[] = []
  const apply = (key: string, value: string) => {
    const res = setKey(text, key, value)
    text = res.text
    if (res.changed) changed.push(key)
  }
  apply('MAIL_MAILER', 'smtp')
  apply('MAIL_HOST', '127.0.0.1')
  apply('MAIL_PORT', String(ports.smtp))
  apply('MAIL_USERNAME', smtpAuth.enabled ? smtpAuth.user : 'null')
  apply('MAIL_PASSWORD', smtpAuth.enabled ? smtpAuth.password : 'null')
  apply('MAIL_ENCRYPTION', tls ? (directTls ? 'ssl' : 'tls') : 'null')
  if (hasKey(text, 'MAIL_SCHEME')) apply('MAIL_SCHEME', directTls ? 'smtps' : 'smtp')

  let backup: string | null = null
  if (existsSync(file)) {
    const dir = join(BACKUP_ROOT, nowStamp(), 'env')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    backup = join(dir, `${basename(site.path)}-env`)
    // El .env lleva credenciales de base de datos: la copia no puede quedar con
    // los permisos del original, ni siquiera si el proyecto los tenía abiertos.
    await copyFile(file, backup)
    await chmod(backup, 0o600)
  }
  await writeFile(file, text, { mode: 0o600 })
  await chmod(file, 0o600)
  return { site: site.name, file, backup, changed }
}

function iniFiles(version: string): { fpm: string; cli: string } {
  return {
    fpm: `/etc/php/${version}/fpm/php.ini`,
    cli: `/etc/php/${version}/cli/php.ini`
  }
}

function parseSendmailPath(src: string): string | null {
  const m = src.match(/^\s*sendmail_path\s*=\s*(.*)$/m)
  if (!m) return null
  return m[1].trim().replace(/^"(.*)"$/, '$1')
}

function isMailpitCommand(value: string | null): boolean {
  return Boolean(value && /mailpit/.test(value) && /sendmail/.test(value))
}

async function readRootFile(file: string): Promise<string | null> {
  try { return await readFile(file, 'utf8') } catch { /* puede requerir root */ }
  try { return await sudo('cat', [file]) } catch { return null }
}

/**
 * Escribe un archivo de root con el contenido por la entrada estándar. Antes se
 * dejaba un archivo temporal en /tmp y se copiaba con `cp`: entre la escritura y
 * la copia, el usuario podía cambiarlo y colar contenido arbitrario en /etc.
 */
async function writeRootFile(file: string, content: string) {
  await runInput('pkexec', ['tee', file], content)
}

function replaceSendmailPath(src: string, command: string | null): string {
  if (!command) return src.replace(/^\s*sendmail_path\s*=.*(?:\r?\n)?/m, '')
  const line = `sendmail_path = ${command}`
  if (/^\s*sendmail_path\s*=.*$/m.test(src)) return src.replace(/^\s*sendmail_path\s*=.*$/m, line)
  return `${src.replace(/\n*$/, '\n')}${line}\n`
}

export async function sendmailInfo(): Promise<MailpitSendmailInfo[]> {
  const [config, php] = await Promise.all([loadConfig(), phpInfo()])
  const binary = (await resolveBinary(config)).binary
  const ports = configPorts(config)
  const command = binary ? `${binary} ${SENDMAIL_CMD} -S 127.0.0.1:${ports.smtp}` : `mailpit ${SENDMAIL_CMD} -S 127.0.0.1:${ports.smtp}`
  const out: MailpitSendmailInfo[] = []
  for (const version of php.versions) {
    const files = iniFiles(version)
    const fpm = existsSync(files.fpm) ? files.fpm : null
    const cli = existsSync(files.cli) ? files.cli : null
    let enabled = false
    for (const file of [fpm, cli]) {
      if (!file) continue
      const src = await readRootFile(file)
      if (src && isMailpitCommand(parseSendmailPath(src))) enabled = true
    }
    out.push({ version, installed: Boolean(fpm || cli), enabled, fpmFile: fpm, cliFile: cli, sendmailPath: command })
  }
  return out
}

export async function setPhpSendmail(version: string, enable: boolean): Promise<void> {
  if (!/^\d+\.\d+$/.test(version)) throw new Error('Versión PHP no válida')
  const config = await loadConfig()
  const binary = (await resolveBinary(config)).binary
  if (enable && !binary) throw new Error('Instala Mailpit antes de configurar sendmail')
  const ports = configPorts(config)
  const command = binary ? `${binary} ${SENDMAIL_CMD} -S 127.0.0.1:${ports.smtp}` : null
  const files = iniFiles(version)
  const state = await loadSendmailState()
  if (!enable && !state[version]) return
  const entry: { fpm?: string | null; cli?: string | null } = { ...(state[version] ?? {}) }

  const changed: { file: string; content: string }[] = []
  const backups: { file: string; content: string }[] = []
  try {
    for (const [kind, file] of Object.entries(files) as ['fpm' | 'cli', string][]) {
      if (!existsSync(file)) continue
      const src = await readRootFile(file)
      if (src == null) throw new Error(`No se pudo leer ${file}`)
      const current = parseSendmailPath(src)
      if (!(kind in entry)) entry[kind] = current
      const next = replaceSendmailPath(src, enable ? command : entry[kind] ?? null)
      if (next !== src) {
        backups.push({ file, content: src })
        changed.push({ file, content: next })
      }
    }
    if (!changed.length) {
      if (enable) throw new Error(`No se encontró php.ini de PHP ${version}`)
      return
    }
    await saveSendmailState({ ...state, [version]: { fpm: entry.fpm ?? null, cli: entry.cli ?? null } })
    const dir = join(BACKUP_ROOT, nowStamp(), 'php')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    for (const b of backups) {
      await writeFile(join(dir, `${version}-${basename(b.file)}`), b.content, { mode: 0o600 })
    }
    for (const c of changed) await writeRootFile(c.file, c.content)
    const test = await run(`php-fpm${version}`, ['-t'], true)
    if (/failed|error/i.test(test)) throw new Error(`php-fpm${version} rechazó la configuración: ${test.trim()}`)
    const active = (await run('systemctl', ['is-active', `php${version}-fpm`], true)).trim() === 'active'
    if (active) await sudo('systemctl', ['restart', `php${version}-fpm`])
  } catch (e) {
    for (const b of backups) await writeRootFile(b.file, b.content).catch(() => '')
    throw e
  }
}

async function phpBinary(version: string): Promise<string> {
  const versioned = `/usr/bin/php${version}`
  if (existsSync(versioned)) return versioned
  return 'php'
}

function phpString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`
}

/** Envía un correo con mail() y comprueba que Mailpit recibe un mensaje nuevo. */
export async function testPhpMail(version: string, to: string): Promise<void> {
  if (!/^\d+\.\d+$/.test(version)) throw new Error('Versión PHP no válida')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Dirección de correo no válida')
  const before = await messageCount()
  const binary = await phpBinary(version)
  const code = `exit(mail(${phpString(to)}, "Prueba de sendmail", "Correo enviado desde PHP ${version} con Valet Dashboard") ? 0 : 1);`
  await run(binary, ['-r', code])
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const now = await messageCount()
    if (now != null && before != null && now > before) return
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('PHP aceptó el envío, pero Mailpit no muestra un mensaje nuevo. Revisa sendmail_path y el registro de Mailpit.')
}
