import { homedir, tmpdir } from 'node:os'
import { join, basename, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile, copyFile, stat, realpath, rm } from 'node:fs/promises'
import type { ApacheInfo, PhpInfo, PortsInfo, PortUsage, Service, ServiceAction, Site } from '../shared/types'
import { run, sudo } from './exec'
import { prepareHelpers, runValet } from './helpers'

const HOME = homedir()
const VALET = join(HOME, '.valet')
const APP = join(HOME, '.valet-dashboard')
const expandHome = (p: string) => (p === '~' ? HOME : p.startsWith('~/') ? join(HOME, p.slice(2)) : p)
const NGINX_SYSTEM = '/etc/nginx/sites-available/valet.conf'
const APACHE_DIR = '/etc/apache2'
const APACHE_PORTS = join(APACHE_DIR, 'ports.conf')
const APACHE_SITES = join(APACHE_DIR, 'sites-enabled')

interface AppConfig {
  http: number
  https: number
  apache?: { http: number; https: number }
}
interface Changed { file: string; backup: string; root: boolean }

/** Los nombres llegan como argumento de execFile (sin shell): solo evitamos opciones y rutas. */
const assertName = (n: string) => {
  if (typeof n !== 'string' || !n || n.trim() !== n || n === '.' || n === '..' ||
    n.startsWith('-') || /[/\\\0-\x1f\x7f]/.test(n)) throw new Error('Nombre no válido')
}
const assertPort = (p: number) => {
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`Puerto no válido: ${p}`)
}
const RESERVED_PORTS: Record<number, string> = { 53: 'DNS', 67: 'DHCP', 68: 'DHCP', 123: 'NTP', 5353: 'mDNS', 5354: 'DNS seguro' }
/** Evita romper DNS/DHCP/NTP/mDNS al mover los puertos web. */
const assertWebPort = (p: number) => {
  assertPort(p)
  if (RESERVED_PORTS[p]) throw new Error(`El puerto ${p} está reservado para ${RESERVED_PORTS[p]}. Elige otro para no afectar a la red.`)
}

// ---------------- Sitios ----------------
async function valetConfig(): Promise<{ tld: string; paths: string[] }> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(VALET, 'config.json'), 'utf8'))
    const c = (raw && typeof raw === 'object' ? raw : {}) as { tld?: unknown; domain?: unknown; paths?: unknown }
    const rawTld = typeof c.domain === 'string' ? c.domain : c.tld
    const tld = typeof rawTld === 'string' && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(rawTld.trim()) ? rawTld.trim() : 'test'
    const paths = Array.isArray(c.paths)
      ? c.paths.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map(expandHome)
      : []
    return { tld, paths }
  } catch { return { tld: 'test', paths: [] } }
}

/** Dominio que Valet usa para los sitios (config.json escribe "domain"). */
export async function valetDomain(): Promise<string> {
  return (await valetConfig()).tld
}

export async function listSites(): Promise<Site[]> {
  const { tld, paths } = await valetConfig()
  const sites = new Map<string, Site>()
  const add = async (dir: string, kind: Site['kind']) => {
    if (!existsSync(dir)) return
    let entries: string[]
    try { entries = await readdir(dir) } catch { return }
    for (const e of entries) {
      const full = join(dir, e)
      try {
        if (!(await stat(full)).isDirectory()) continue
        // Un enlace (valet link) tiene prioridad sobre un parked con el mismo nombre.
        if (kind === 'parked' && sites.has(e)) continue
        sites.set(e, {
          name: e, kind, path: await realpath(full),
          secure: existsSync(join(VALET, 'Certificates', `${e}.${tld}.crt`))
        })
      } catch { /* enlace roto */ }
    }
  }
  const linksDir = resolve(join(VALET, 'Sites'))
  for (const p of paths) {
    if (resolve(p) === linksDir) continue
    await add(p, 'parked')
  }
  await add(linksDir, 'linked')
  return [...sites.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function setSecure(name: string, on: boolean) {
  assertName(name)
  await prepareHelpers()
  await runValet([on ? 'secure' : 'unsecure', name])
}

// ---------------- PHP ----------------
export async function phpInfo(): Promise<PhpInfo> {
  const versions: string[] = []
  for (const dir of ['/usr/sbin', '/usr/bin']) {
    if (!existsSync(dir)) continue
    for (const f of await readdir(dir)) {
      const m = f.match(/^php-fpm(\d+\.\d+)$/)
      if (m && !versions.includes(m[1])) versions.push(m[1])
    }
  }
  const current = (await run('php', ['-r', 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;'], true)).trim()
  return { versions: versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })), current }
}

export async function usePhp(version: string) {
  if (!/^\d+\.\d+$/.test(version)) throw new Error('Versión no válida')
  await prepareHelpers()
  await runValet(['use', `php@${version}`])
}

// ---------------- Puertos ----------------
const validPort = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535

async function appConfig(): Promise<AppConfig> {
  try {
    const c = JSON.parse(await readFile(join(APP, 'config.json'), 'utf8')) as Partial<AppConfig>
    const http = typeof c.http === 'number' && validPort(c.http) ? c.http : 80
    const https = typeof c.https === 'number' && validPort(c.https) ? c.https : 443
    const a = c.apache
    const apache = a && typeof a.http === 'number' && validPort(a.http) && typeof a.https === 'number' && validPort(a.https)
      ? { http: a.http, https: a.https } : undefined
    return apache ? { http, https, apache } : { http, https }
  } catch { return { http: 80, https: 443 } }
}

async function saveConfig(patch: Partial<AppConfig>) {
  await mkdir(APP, { recursive: true })
  await writeFile(join(APP, 'config.json'), JSON.stringify({ ...(await appConfig()), ...patch }, null, 2))
}

const portFromAddress = (addr: string): number | null => {
  const only = addr.trim().split(/\s+/)[0]
  const port = Number(only.slice(only.lastIndexOf(':') + 1))
  return validPort(port) ? port : null
}

async function listenUsage(): Promise<PortUsage[]> {
  const out = await run('ss', ['-tlnpH'], true)
  const usage: PortUsage[] = []
  for (const line of out.split('\n')) {
    const c = line.trim().split(/\s+/)
    if (c.length < 5) continue
    const port = Number(c[3].slice(c[3].lastIndexOf(':') + 1))
    if (!validPort(port)) continue
    const p = line.match(/\("([^"]+)",pid=(\d+)/)
    if (!usage.some((u) => u.port === port)) usage.push({ port, process: p?.[1] ?? '—', pid: p?.[2] ?? '' })
  }
  return usage.sort((a, b) => a.port - b.port)
}

const isActive = async (service: string) => (await run('systemctl', ['is-active', service], true)).trim() === 'active'
const isEnabled = async (service: string) => (await run('systemctl', ['is-enabled', service], true)).trim() === 'enabled'

async function nginxFiles(): Promise<{ file: string; root: boolean }[]> {
  const files: { file: string; root: boolean }[] = []
  const dir = join(VALET, 'Nginx')
  if (existsSync(dir)) {
    for (const f of await readdir(dir)) if (f.endsWith('.conf')) files.push({ file: join(dir, f), root: false })
  }
  if (existsSync(NGINX_SYSTEM)) files.push({ file: NGINX_SYSTEM, root: true })
  return files
}

/** Puertos reales de nginx, para no depender solo de lo último guardado por la app. */
async function detectNginxPorts(files: { file: string }[]): Promise<{ http: number; https: number }> {
  let http: number | undefined
  let https: number | undefined
  for (const { file } of files) {
    let src = ''
    try { src = await readFile(file, 'utf8') } catch { continue }
    for (const m of src.matchAll(/^\s*listen\s+([^;#]+);/gmi)) {
      const port = portFromAddress(m[1])
      if (!port) continue
      if (/\bssl\b/i.test(m[1])) https ??= port
      else http ??= port
    }
  }
  const saved = await appConfig()
  return { http: http ?? saved.http, https: https ?? saved.https }
}

async function assertPortsFree(ports: number[], owner: RegExp) {
  const usage = await listenUsage()
  for (const port of ports) {
    const used = usage.find((u) => u.port === port)
    if (used && !owner.test(used.process)) {
      const who = used.process === '—' ? 'otro proceso' : used.process
      throw new Error(`El puerto ${port} ya está ocupado por ${who}${used.pid ? ` (pid ${used.pid})` : ''}. Elige otro puerto.`)
    }
  }
}

async function backupFile(file: string, stamp: string, kind: string, root: boolean): Promise<Changed> {
  const dir = join(APP, 'backups', stamp, kind)
  await mkdir(dir, { recursive: true })
  const backup = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${basename(file)}`)
  await copyFile(file, backup)
  return { file, backup, root }
}

/** Restaura las copias y devuelve los archivos que no se pudieron recuperar. */
async function restoreFiles(changed: Changed[]): Promise<string[]> {
  const failed: string[] = []
  for (const c of changed) {
    try {
      if (c.root) await sudo('cp', [c.backup, c.file])
      else await copyFile(c.backup, c.file)
    } catch { failed.push(c.file) }
  }
  return failed
}

const restoreNote = (failed: string[]) =>
  failed.length ? `\nNo se pudieron restaurar: ${failed.join(', ')}` : ''

async function writePrivileged(file: string, content: string) {
  const tmp = join(tmpdir(), `valet-dash-${process.pid}-${Date.now()}-${basename(file)}`)
  await writeFile(tmp, content)
  try { await sudo('cp', [tmp, file]) } finally { await rm(tmp, { force: true }).catch(() => '') }
}

async function patchFile(file: string, transform: (src: string) => string, root: boolean, stamp: string, kind: string): Promise<Changed | null> {
  if (!existsSync(file)) return null
  const src = await readFile(file, 'utf8')
  const out = transform(src)
  if (out === src) return null
  const changed = await backupFile(file, stamp, kind, root)
  if (root) await writePrivileged(file, out)
  else await writeFile(file, out)
  return changed
}

const nginxTransform = (map: Record<number, number>) => (src: string) =>
  src.replace(/(^\s*listen\s+(?:\[[^\]]*\]:|[^\s:]+:)?)(\d+)/gmi, (m, pre: string, port: string) => {
    const to = map[Number(port)]
    return to ? `${pre}${to}` : m
  })

export async function scanPorts(): Promise<PortsInfo> {
  const files = await nginxFiles()
  const [usage, config, apache, nginxActive] = await Promise.all([
    listenUsage(), detectNginxPorts(files), apacheInfo(), isActive('nginx')
  ])
  return { config, usage, nginxActive, apache }
}

export async function setPorts(http: number, https: number) {
  assertWebPort(http); assertWebPort(https)
  if (http === https) throw new Error('HTTP y HTTPS no pueden ser el mismo puerto')
  const files = await nginxFiles()
  if (!files.length) throw new Error('No se encontró la configuración de nginx de Valet. Instala Valet primero.')
  const current = await detectNginxPorts(files)
  if (http === current.http && https === current.https) return
  if (current.http === current.https)
    throw new Error(`La configuración actual de nginx usa el mismo puerto (${current.http}) para HTTP y HTTPS. Corrígela antes de cambiarla desde aquí.`)
  await assertPortsFree([http, https], /^nginx$/i)
  const map: Record<number, number> = { [current.http]: http, [current.https]: https }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const changed: Changed[] = []
  try {
    for (const { file, root } of files) {
      const c = await patchFile(file, nginxTransform(map), root, stamp, 'nginx')
      if (c) changed.push(c)
    }
  } catch (e) {
    const failed = await restoreFiles(changed)
    const msg = (e as Error).message.trim()
    const state = failed.length ? 'no se pudo restaurar por completo' : 'se restauró la anterior'
    throw new Error(`No se pudieron escribir los cambios de nginx; ${state}.${restoreNote(failed)}${msg ? `\n${msg}` : ''}`)
  }
  if (!changed.length) throw new Error('No se encontraron directivas listen que actualizar. Revisa la configuración de Valet.')
  const wasActive = await isActive('nginx')
  try {
    await sudo('nginx', ['-t'])
    if (wasActive) await sudo('systemctl', ['reload', 'nginx'])
    else await sudo('systemctl', ['start', 'nginx'])
  } catch (e) {
    const failed = await restoreFiles(changed)
    if (wasActive) await sudo('systemctl', ['reload', 'nginx']).catch(() => '')
    const msg = (e as Error).message.trim()
    const state = failed.length ? 'no se pudo restaurar por completo' : 'se restauró la anterior'
    throw new Error(`nginx rechazó la configuración; ${state}.${restoreNote(failed)}${msg ? `\n${msg}` : ''}`)
  }
  await saveConfig({ http, https })
}

// ---------------- Apache ----------------
async function apacheFiles(includeAvailable = false): Promise<string[]> {
  const files: string[] = []
  if (existsSync(APACHE_PORTS)) files.push(APACHE_PORTS)
  const dirs = includeAvailable ? [APACHE_SITES, join(APACHE_DIR, 'sites-available')] : [APACHE_SITES]
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.conf')) continue
      try { files.push(await realpath(join(dir, f))) } catch { /* enlace roto */ }
    }
  }
  return [...new Set(files)]
}

async function parseApachePorts(files: string[]): Promise<{ http: number | null; https: number | null }> {
  let vhostHttp: number | null = null
  let vhostHttps: number | null = null
  const listens: number[] = []
  for (const file of files) {
    let src = ''
    try { src = await readFile(file, 'utf8') } catch { continue }
    for (const m of src.matchAll(/^\s*Listen\s+([^\s#;]+)/gmi)) {
      const port = portFromAddress(m[1])
      if (port) listens.push(port)
    }
    for (const m of src.matchAll(/<VirtualHost\b([^>]*)>([\s\S]*?)<\/VirtualHost>/gi)) {
      const ssl = /SSLEngine\s+on/i.test(m[2])
      for (const pm of m[1].matchAll(/:(\d+)\b/g)) {
        const port = Number(pm[1])
        if (ssl && vhostHttps == null) vhostHttps = port
        else if (!ssl && vhostHttp == null) vhostHttp = port
      }
    }
  }
  const listenHttps = listens.includes(443) ? 443 : null
  const listenHttp = listens.find((p) => p !== listenHttps) ?? null
  return { http: listenHttp ?? vhostHttp, https: listenHttps ?? vhostHttps }
}

export async function apacheInfo(): Promise<ApacheInfo> {
  if (!existsSync(APACHE_PORTS)) return { installed: false, active: false, enabled: false, http: null, https: null }
  const parsed = await parseApachePorts(await apacheFiles())
  const saved = (await appConfig()).apache
  const [active, enabled] = await Promise.all([isActive('apache2'), isEnabled('apache2')])
  return {
    installed: true, active, enabled,
    http: parsed.http ?? saved?.http ?? null,
    https: parsed.https ?? saved?.https ?? null
  }
}

const apacheTransform = (map: Record<number, number>) => (src: string) => {
  let out = src.replace(/(^\s*Listen\s+(?:\[[^\]]*\]:|[^\s:#]+:)?)(\d+)/gmi, (m, pre: string, port: string) => {
    const to = map[Number(port)]
    return to ? `${pre}${to}` : m
  })
  out = out.replace(/<VirtualHost\b[^>]*>/gi, (tag) =>
    tag.replace(/:(\d+)\b/g, (m, port: string) => map[Number(port)] ? `:${map[Number(port)]}` : m))
  return out
}

export async function setApachePorts(http: number, https: number) {
  assertWebPort(http); assertWebPort(https)
  if (http === https) throw new Error('HTTP y HTTPS no pueden ser el mismo puerto')
  if (!existsSync(APACHE_PORTS)) throw new Error('Apache no está instalado en este sistema')
  const activeFiles = await apacheFiles()
  const allFiles = await apacheFiles(true)
  if (!allFiles.length) throw new Error('No se encontró la configuración de Apache')
  const parsed = await parseApachePorts(activeFiles)
  const saved = (await appConfig()).apache
  const current = { http: parsed.http ?? saved?.http ?? null, https: parsed.https ?? saved?.https ?? null }
  if (current.http == null || current.https == null)
    throw new Error('No se pudieron detectar los puertos actuales de Apache (revisa ports.conf y los VirtualHost)')
  if (http === current.http && https === current.https) return
  if (current.http === current.https)
    throw new Error(`La configuración actual de Apache usa el mismo puerto (${current.http}) para HTTP y HTTPS. Corrígela antes de cambiarla desde aquí.`)
  await assertPortsFree([http, https], /^(apache2?|httpd)$/i)
  const map: Record<number, number> = { [current.http]: http, [current.https]: https }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const changed: Changed[] = []
  try {
    for (const file of allFiles) {
      const c = await patchFile(file, apacheTransform(map), true, stamp, 'apache')
      if (c) changed.push(c)
    }
  } catch (e) {
    const failed = await restoreFiles(changed)
    const msg = (e as Error).message.trim()
    const state = failed.length ? 'no se pudo restaurar por completo' : 'se restauró la anterior'
    throw new Error(`No se pudieron escribir los cambios de Apache; ${state}.${restoreNote(failed)}${msg ? `\n${msg}` : ''}`)
  }
  if (!changed.length) throw new Error('No se encontraron directivas Listen ni VirtualHost que actualizar en Apache.')
  const wasActive = await isActive('apache2')
  try {
    await sudo('apache2ctl', ['configtest'])
    if (wasActive) await sudo('systemctl', ['reload', 'apache2'])
  } catch (e) {
    const failed = await restoreFiles(changed)
    if (wasActive) await sudo('systemctl', ['reload', 'apache2']).catch(() => '')
    const msg = (e as Error).message.trim()
    const state = failed.length ? 'no se pudo restaurar por completo' : 'se restauró la anterior'
    throw new Error(`Apache rechazó la configuración; ${state}.${restoreNote(failed)}${msg ? `\n${msg}` : ''}`)
  }
  await saveConfig({ apache: { http, https } })
}

// ---------------- Servicios ----------------
const WANTED = /^(nginx|dnsmasq|valet-dns|valet-dashboard-dns|apache2|mysql|mysqld|mariadb|redis|redis-server|postgresql|php\d+\.\d+-fpm)\.service$/

export async function listServices(): Promise<Service[]> {
  const units = await run('systemctl', ['list-unit-files', '--type=service', '--no-legend', '--no-pager'], true)
  const names = units.split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((c) => c.length >= 2 && WANTED.test(c[0]) && c[1] !== 'alias')
    .map((c) => c[0].replace('.service', ''))
  if (!names.length) return []
  const st = (await run('systemctl', ['is-active', ...names], true)).trim().split('\n')
  return names.map((name, i) => ({ name, active: st[i] === 'active' }))
}

export async function serviceAction(name: string, action: ServiceAction) {
  if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Acción no válida')
  if (!(await listServices()).some((s) => s.name === name)) throw new Error('Servicio desconocido')
  await sudo('systemctl', [action, name])
}
