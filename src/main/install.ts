import { homedir } from 'node:os'
import { join, isAbsolute, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, statfs, writeFile } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import type { DnsMode, Env, InstallEvent, InstallOptions, Prereq } from '../shared/types'
import { APP_DIR, COMPOSER_BIN, COMPOSER_HOME, TIMEOUT_MS, run } from './exec'
import { BACKUP_SCRIPT, DNS_SCRIPT } from './root-scripts'
import {
  ROOT_HELPER_DIR, USER_NAME, installRootHelper, prepareHelpers, privilegedEnv, runValet, unprivilegedEnv
} from './helpers'
import { detectElevation, elevated, elevationCommand } from './elevate'
import { classify } from './errors'
import {
  evaluate, hasBlocking, installArgs, mirrorHost, missingQuery, parseMissing, requiredPackages, updateArgs,
  type Pm, type PrereqProbe
} from './prereqs'
import { apacheInfo, listSites, phpInfo, scanPorts, valetDomain, valetHttpPort } from './valet'

const HOME = homedir()
const PKG_RE = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i
const DNS_MODES: DnsMode[] = ['safe', 'hosts', 'classic']
const DNS_PORT = 5354
const DNS_HELPER = join(ROOT_HELPER_DIR, 'dns-helper.sh')
const BACKUP_HELPER = join(ROOT_HELPER_DIR, 'backup.sh')
const TOOL_NAMES = [
  'php', 'composer', 'valet', 'nginx', 'dnsmasq', 'nmcli', 'certutil',
  'xsel', 'pkexec', 'sudo', 'zenity', 'kdialog', 'jq', 'git', 'unzip'
]
let busy = false
let current: ChildProcess | null = null
let cancelRequested = false

export type Emit = (e: InstallEvent) => void
export type Step = { id: string; label: string; fn: () => Promise<'skip' | void> }

export async function distro(): Promise<{ id: string; pm: Pm | null }> {
  const t = await readFile('/etc/os-release', 'utf8').catch(() => '')
  const get = (k: string) => (t.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').replace(/"/g, '')
  const s = `${get('ID')} ${get('ID_LIKE')}`
  const pm: Pm | null = /debian|ubuntu/.test(s) ? 'apt' : /fedora|rhel|centos/.test(s) ? 'dnf' : /arch/.test(s) ? 'pacman' : null
  return { id: get('PRETTY_NAME') || get('NAME') || get('ID') || 'desconocida', pm }
}

const has = async (c: string) => (await run('which', [c], true)).trim() !== ''
const active = async (service: string) => (await run('systemctl', ['is-active', service], true)).trim() === 'active'

async function phpVersion(): Promise<string | null> {
  const v = (await run('php', ['-r', 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;'], true)).trim()
  return /^\d+\.\d+$/.test(v) ? v : null
}

async function diskFreeMb(): Promise<number> {
  const st = await statfs(HOME).catch(() => null)
  if (!st) return Number.POSITIVE_INFINITY
  return (st.bavail * st.bsize) / (1024 * 1024)
}

/** Comprueba que el repositorio se resuelve. `null` si no se puede saber. */
async function networkOk(pm: Pm | null): Promise<boolean | null> {
  if (!pm) return null
  const out = await run('getent', ['hosts', mirrorHost(pm)], true)
  return out.trim() !== ''
}

async function probeTools(): Promise<Record<string, boolean>> {
  const tools: Record<string, boolean> = {}
  await Promise.all(TOOL_NAMES.map(async (t) => { tools[t] = await has(t) }))
  return tools
}

function normalizePkg(p: string): string {
  if (typeof p !== 'string' || !PKG_RE.test(p)) throw new Error('Paquete de Composer no válido (vendor/nombre)')
  return p.toLowerCase()
}

function normalizeDnsMode(mode: unknown): DnsMode {
  return typeof mode === 'string' && DNS_MODES.includes(mode as DnsMode) ? mode as DnsMode : 'safe'
}

async function prepareInstallScripts() {
  await installRootHelper('dns-helper.sh', DNS_SCRIPT)
  await installRootHelper('backup.sh', BACKUP_SCRIPT)
}

type ShOptions = { cwd?: string; extraEnv?: NodeJS.ProcessEnv; env?: NodeJS.ProcessEnv; pm?: Pm | null }

/**
 * Composer ejecuta scripts y plugins de paquetes de terceros: su entorno no
 * incluye el ayudante `sudo` ni `SUDO_ASKPASS` que sí usa Valet.
 */
export const composerEnv = (): NodeJS.ProcessEnv =>
  unprivilegedEnv({ COMPOSER_HOME, COMPOSER_NO_INTERACTION: '1' })

/** Ejecuta un paso cualquiera y, si falla, emite el diagnóstico clasificado. */
export function sh(emit: Emit, cmd: string, args: string[], opts: ShOptions = {}): Promise<void> {
  emit({ type: 'log', text: `$ ${cmd} ${args.join(' ')}\n` })
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { env: opts.env ?? privilegedEnv(opts.extraEnv), cwd: opts.cwd })
    current = c
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; c.kill('SIGTERM') }, TIMEOUT_MS)
    const out = (b: Buffer) => emit({ type: 'log', text: b.toString() })
    c.stdout?.on('data', out)
    c.stderr?.on('data', (b: Buffer) => { stderr += b.toString(); out(b) })
    c.on('error', (e) => { clearTimeout(timer); current = null; reject(e) })
    c.on('close', (code) => {
      clearTimeout(timer)
      current = null
      if (cancelRequested) {
        cancelRequested = false
        return reject(new Error('Operación cancelada'))
      }
      if (code === 0) return resolve()
      const error = classify({ cmd, args, code, stderr, killed: timedOut, pm: opts.pm ?? null })
      emit({ type: 'error', ...error })
      reject(new Error(error.title))
    })
  })
}

/** Igual que {@link sh}, con la elevación que haya disponible. */
export async function shElevated(emit: Emit, cmd: string, args: string[], opts: ShOptions = {}): Promise<void> {
  const how = await elevationCommand()
  if (!how) throw new Error('No hay método de elevación: instala polkit (pkexec) o sudo con zenity')
  return sh(emit, how.cmd, [...how.args, cmd, ...args], opts)
}

export async function runSteps(steps: Step[], emit: Emit) {
  if (busy) throw new Error('Ya hay una operación en curso')
  busy = true
  cancelRequested = false
  try {
    emit({ type: 'plan', steps: steps.map(({ id, label }) => ({ id, label })) })
    for (const s of steps) {
      if (cancelRequested) throw new Error('Operación cancelada')
      emit({ type: 'step', id: s.id, status: 'run' })
      try {
        emit({ type: 'step', id: s.id, status: (await s.fn()) === 'skip' ? 'skip' : 'ok' })
      } catch (e) {
        emit({ type: 'step', id: s.id, status: 'fail' })
        emit({ type: 'log', text: `\n✖ ${(e as Error).message}\n` })
        throw e
      }
    }
  } finally {
    busy = false
    cancelRequested = false
  }
}

/** Detiene el comando en curso. La interfaz vuelve a quedar utilizable. */
export function cancelInstall(): void {
  if (!busy) return
  cancelRequested = true
  current?.kill('SIGTERM')
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function backupSystem(emit: Emit): Promise<string> {
  const dest = join(APP_DIR, 'backups', stamp(), 'system')
  if (!dest.startsWith(APP_DIR + sep)) throw new Error('Ruta de copia de seguridad no válida')
  await mkdir(APP_DIR, { recursive: true })
  await elevated(BACKUP_HELPER, [dest, USER_NAME])
  emit({ type: 'log', text: `Copia de seguridad: ${dest}\n` })
  return dest
}

async function writeHostsFile(emit: Emit): Promise<string> {
  const domain = await valetDomain().catch(() => 'test')
  const names = new Set<string>(['valet-dashboard'])
  for (const s of await listSites().catch(() => [])) {
    if (/^[a-z0-9.-]+$/i.test(s.name)) names.add(s.name)
  }
  const body = [...names].sort().map((n) => `127.0.0.1 ${n}.${domain}`).join('\n') + '\n'
  const file = join(APP_DIR, 'hosts-generated')
  await mkdir(APP_DIR, { recursive: true })
  await writeFile(file, body, { mode: 0o600 })
  emit({ type: 'log', text: `Entradas de hosts preparadas: ${names.size}\n` })
  return file
}

export async function patchValetDns(pkg: string, emit: Emit) {
  const [vendor, name] = pkg.split('/')
  const file = join(COMPOSER_HOME, 'vendor', vendor, name, 'cli', 'Valet', 'DnsMasq.php')
  if (!existsSync(file)) throw new Error(`No se encontró ${file}. Composer no instaló el paquete esperado.`)
  let src = await readFile(file, 'utf8')
  const original = src
  if ((src.match(/VALET_DASHBOARD_SAFE_DNS/g) ?? []).length >= 2) {
    emit({ type: 'log', text: 'Parche DNS seguro ya aplicado.\n' })
    return
  }
  const guard = `
        if (getenv('VALET_DASHBOARD_SAFE_DNS') === '1') {
            info('Valet Dashboard: cambios de DNS de Valet omitidos.');
            return;
        }
`
  src = src.replace(/(public function install\([^)]*\)\s*\{\r?\n)/, (_m, pre: string) => `${pre}${guard}`)
  src = src.replace(/(public function uninstall\(\)\s*\{\r?\n)/, (_m, pre: string) => `${pre}${guard}`)
  if ((src.match(/VALET_DASHBOARD_SAFE_DNS/g) ?? []).length < 2) {
    throw new Error('No se pudo aplicar el parche DNS seguro; se cancela antes de tocar la red.')
  }
  await writeFile(file, src)
  try {
    await run('php', ['-l', file])
  } catch (e) {
    await writeFile(file, original)
    throw new Error(`El parche DNS dejó PHP inválido; se restauró el archivo: ${(e as Error).message}`)
  }
  emit({ type: 'log', text: `Parche DNS seguro aplicado en ${file}\n` })
}

async function applyDns(emit: Emit, mode: DnsMode): Promise<'skip' | void> {
  if (mode === 'classic') return 'skip'
  const domain = await valetDomain().catch(() => 'test')
  const backupDir = join(APP_DIR, 'backups', stamp(), 'dns')
  const hostsFile = mode === 'hosts' ? await writeHostsFile(emit) : ''
  await elevated(DNS_HELPER, [mode, domain, backupDir, hostsFile, USER_NAME])
  const name = `valet-dashboard.${domain}`
  const resolved = (await run('getent', ['hosts', name], true)).trim()
  if (!resolved.includes('127.0.0.1')) {
    throw new Error(`No se pudo verificar ${name}; revisa systemd-resolved o usa el modo hosts.`)
  }
  emit({ type: 'log', text: `DNS verificado: ${name} -> 127.0.0.1\n` })
}

async function removeDns(emit: Emit) {
  const domain = await valetDomain().catch(() => 'test')
  const backupDir = join(APP_DIR, 'backups', stamp(), 'dns-remove')
  await elevated(DNS_HELPER, ['remove', domain, backupDir, '', USER_NAME])
  emit({ type: 'log', text: 'DNS del dashboard eliminado.\n' })
}

async function requireElevation() {
  if (!(await detectElevation())) {
    throw new Error('Falta un método de elevación: instala polkit (pkexec) o sudo con zenity')
  }
}

/** Paquetes de la lista que aún no están instalados. */
async function missingPackages(pm: Pm, packages: string[]): Promise<string[]> {
  const q = missingQuery(pm, packages)
  const out = await run(q.cmd, q.args, true)
  return parseMissing(pm, packages, out)
}

export async function checkEnv(): Promise<Env> {
  const d = await distro()
  const [tools, systemd, disk, network, elevation] = await Promise.all([
    probeTools(),
    Promise.resolve(existsSync('/run/systemd/system')),
    diskFreeMb(),
    networkOk(d.pm),
    detectElevation()
  ])
  const probe: PrereqProbe = {
    pm: d.pm,
    systemd,
    graphical: Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY),
    diskFreeMb: disk,
    network,
    tools
  }
  const prereqs: Prereq[] = evaluate(probe)

  const [ports, nm, resolved, dnsmasqService, dashboardService, valetDnsService, udp, resolvTarget, resolvContent, show, domain, isolatedValet] = await Promise.all([
    scanPorts(),
    active('NetworkManager'),
    active('systemd-resolved'),
    active('dnsmasq'),
    active('valet-dashboard-dns'),
    active('valet-dns'),
    run('ss', ['-lun'], true),
    run('readlink', ['-f', '/etc/resolv.conf'], true),
    readFile('/etc/resolv.conf', 'utf8').catch(() => ''),
    run('composer', ['global', 'show'], true),
    valetDomain().catch(() => 'test'),
    Promise.resolve(join(COMPOSER_BIN, 'valet'))
  ])

  const portHogs = ports.usage
    .filter((u) => [80, 443].includes(u.port) && u.process !== 'nginx' && !(u.process === '—' && ports.nginxActive))
    .map((u) => `${u.port}: ${u.process === '—' ? 'proceso de otro usuario' : u.process}`)

  const isolated = existsSync(isolatedValet)
  const stockDns = valetDnsService ||
    existsSync('/opt/valet-linux') ||
    existsSync('/etc/dnsmasq.d/valet') ||
    existsSync('/etc/NetworkManager/conf.d/valet.conf')
  const systemValet = (await run('which', ['valet'], true)).trim()
  const valetPath = isolated ? isolatedValet : (systemValet || null)
  const valetVersion = valetPath ? (await run(valetPath, ['--version'], true)).trim() || null : null
  tools.valet = Boolean(valetPath)

  const dnsPortInUse = ports.usage.some((u) => u.port === DNS_PORT) || new RegExp(`:${DNS_PORT}(?:\\s|$)`).test(udp)
  const portFree = dashboardService || !dnsPortInUse
  const resolvConfOk = /stub-resolv/.test(resolvTarget) || resolvContent.includes('127.0.0.53')
  const testResolves = (await run('getent', ['hosts', `valet-dashboard.${domain}`], true)).includes('127.0.0.1')

  const oldValet = /cpriego\/valet-ubuntu|jmarcher\/valet-linux/.test(show)
  const illuminate13 = /^illuminate\/[^\s]+\s+13\./m.test(show)
  const conflictDetail = oldValet
    ? 'Hay paquetes antiguos de Valet en el Composer global.'
    : illuminate13
      ? 'Illuminate 13 en el Composer global; Valet requiere Illuminate <=12.'
      : ''

  const warnings: string[] = []
  if (portHogs.length) warnings.push(`Puertos 80/443 ocupados: ${portHogs.join(', ')}.`)
  if (conflictDetail) warnings.push(`${conflictDetail} Se usará un Composer aislado.`)
  if (valetPath && !isolated) warnings.push(`Valet externo detectado en ${valetPath}; el instalador prefiere su propio Composer aislado.`)
  if (!resolved) warnings.push('systemd-resolved no está activo; el modo DNS seguro no está disponible.')
  if (!portFree) warnings.push(`El puerto ${DNS_PORT} está ocupado; se recomienda el modo hosts.`)
  if (dnsmasqService) warnings.push(`El servicio dnsmasq del sistema está activo; el DNS seguro usa una instancia propia en ${DNS_PORT}.`)
  if (stockDns) warnings.push('Hay restos del DNS clásico de Valet; el instalador no los modifica. Si el WiFi/DNS falla, restáuralos antes de continuar.')
  if (!resolvConfOk) warnings.push('/etc/resolv.conf no apunta a systemd-resolved; revisa el DNS antes de usar el modo seguro.')
  if (!d.pm) warnings.push('Distribución no soportada para instalar paquetes automáticamente; el panel seguirá con lo que ya esté instalado.')

  const php = await phpInfo().catch(() => null)
  if (php?.current && php.versions.length && !php.versions.includes(php.current)) {
    warnings.push(`Valet usará PHP ${php.current}, pero no hay php${php.current}-fpm. Instala la versión que coincida.`)
  }

  const recommendedDnsMode: DnsMode = resolved && portFree && resolvConfOk && (tools.dnsmasq || d.pm === 'apt') ? 'safe' : 'hosts'

  return {
    distro: d.id,
    pm: d.pm,
    tools,
    portHogs,
    dns: {
      domain,
      networkManager: nm,
      resolvedActive: resolved,
      dnsmasqBinary: tools.dnsmasq,
      dnsmasqServiceActive: dnsmasqService,
      dashboardActive: dashboardService,
      port: DNS_PORT,
      portFree,
      resolvConfOk,
      testResolves
    },
    composer: {
      available: tools.composer,
      globalHome: join(HOME, '.config', 'composer'),
      isolatedHome: COMPOSER_HOME,
      isolatedValet: isolated,
      conflict: Boolean(conflictDetail),
      conflictDetail
    },
    valet: {
      installed: Boolean(valetPath),
      path: valetPath,
      version: valetVersion,
      isolated
    },
    prereqs,
    elevation,
    warnings,
    recommendedDnsMode
  }
}

function resolveParkDir(input: string): string {
  const value = (typeof input === 'string' ? input : '').trim()
  const out = value === ''
    ? join(HOME, 'Sites')
    : value === '~'
      ? HOME
      : value.startsWith('~/')
        ? join(HOME, value.slice(2))
        : value
  if (!isAbsolute(out)) throw new Error('La carpeta de proyectos debe ser una ruta absoluta')
  return out
}

/**
 * Crea un sitio temporal y pide su `index.php` por HTTP. Es la única prueba que
 * responde de verdad «¿funciona Valet?»: cubre nginx, PHP-FPM y permisos.
 */
async function smokeTest(parkDir: string, emit: Emit): Promise<'skip' | void> {
  const dir = join(parkDir, 'valet-dashboard-health')
  if (!dir.startsWith(parkDir + sep)) throw new Error('Ruta de prueba no válida')
  if (existsSync(dir)) {
    emit({ type: 'log', text: `Ya existe ${dir}; se omite la prueba de humo.\n` })
    return 'skip'
  }
  if (!(await has('curl'))) {
    emit({ type: 'log', text: 'No hay curl: se omite la prueba de humo.\n' })
    return 'skip'
  }
  const domain = await valetDomain().catch(() => 'test')
  const port = await valetHttpPort()
  const body = join(APP_DIR, 'smoke-body')
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'index.php'), "<?php echo 'valet-ok';\n")
    const status = (await run('curl', [
      '-sS', '-m', '10', '-o', body, '-w', '%{http_code}',
      '-H', `Host: valet-dashboard-health.${domain}`,
      `http://127.0.0.1:${port}/index.php`
    ], true)).trim()
    const text = await readFile(body, 'utf8').catch(() => '')
    if (status === '200' && text.includes('valet-ok')) {
      emit({ type: 'log', text: `Prueba de humo correcta: nginx y PHP-FPM responden en el puerto ${port}.\n` })
      return
    }
    if (status === '502') {
      throw new Error('PHP-FPM no responde: revisa el socket de ~/.valet y el servicio php-fpm')
    }
    if (status === '404') {
      throw new Error('nginx no encuentra el sitio de prueba: revisa la configuración de Valet')
    }
    if (!status || status === '000' || status === '7') {
      throw new Error(`nginx no responde en el puerto ${port}: revisa systemctl status nginx`)
    }
    throw new Error(`La prueba de humo devolvió HTTP ${status}`)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => '')
    await rm(body, { force: true }).catch(() => '')
  }
}

export async function startInstall(o: InstallOptions, emit: Emit) {
  if (!o || typeof o !== 'object') throw new Error('Opciones de instalación no válidas')
  const pkg = normalizePkg(o.pkg)
  const dnsMode = normalizeDnsMode(o.dnsMode)
  const parkDir = resolveParkDir(o.parkDir)
  const d = await distro()
  await prepareHelpers()

  const S = (id: string, label: string, fn: Step['fn']): Step => ({ id, label, fn })
  let preflight: Env | undefined

  await runSteps([
    S('preflight', 'Comprobar requisitos, puertos y DNS', async () => {
      const info = await checkEnv()
      preflight = info
      const blocking = info.prereqs.filter((p) => !p.ok && p.blocking)
      if (hasBlocking(info.prereqs)) {
        throw new Error(`Faltan requisitos: ${blocking.map((p) => p.label).join(', ')}. Sigue la guía de la pestaña Instalación.`)
      }
      if (info.portHogs.length && !(o.stopApache && info.portHogs.every((h) => /apache/i.test(h)))) {
        throw new Error(`Libera los puertos 80/443 antes de instalar: ${info.portHogs.join(', ')}`)
      }
      if (dnsMode === 'safe') {
        if (!info.dns.resolvedActive) throw new Error('systemd-resolved no está activo; elige el modo hosts o actívalo antes.')
        if (!info.dns.portFree) throw new Error(`El puerto ${DNS_PORT} está ocupado; elige el modo hosts.`)
        if (!info.dns.dnsmasqBinary && info.pm !== 'apt') throw new Error('Falta dnsmasq; instálalo o usa el modo hosts.')
        if (!info.dns.resolvConfOk) throw new Error('/etc/resolv.conf no apunta a systemd-resolved; elige el modo hosts.')
      }
      if (!info.elevation) throw new Error('Falta un método de elevación: instala polkit (pkexec) o sudo con zenity')
      emit({ type: 'log', text: `Elevación: ${info.elevation === 'pkexec' ? 'polkit (pkexec)' : 'sudo con ventana de contraseña'}\n` })
    }),
    S('backup', 'Crear copia de seguridad', async () => {
      await prepareInstallScripts()
      await backupSystem(emit)
    }),
    S('apache', 'Liberar los puertos 80/443 (Apache)', async () => {
      if (!o.stopApache) return 'skip'
      const apache = await apacheInfo()
      const apacheHog = preflight?.portHogs.some((h) => /apache/i.test(h)) ?? false
      if (!apache.active || (!apacheHog && ![apache.http, apache.https].some((p) => p === 80 || p === 443))) return 'skip'
      await shElevated(emit, 'systemctl', ['disable', '--now', 'apache2'])
    }),
    S('deps', 'Instalar dependencias del sistema', async () => {
      const php = await phpVersion()
      const pm = d.pm
      if (!pm) {
        emit({ type: 'log', text: 'Sin gestor de paquetes compatible: se usan los paquetes ya instalados.\n' })
        return 'skip'
      }
      const packages = requiredPackages(pm, php)
      const missing = await missingPackages(pm, packages)
      if (!missing.length) {
        emit({ type: 'log', text: 'Dependencias del sistema ya instaladas.\n' })
        return 'skip'
      }
      emit({ type: 'log', text: `Faltan ${missing.length} paquetes: ${missing.join(', ')}\n` })
      const update = updateArgs(pm)
      if (update) await shElevated(emit, update.cmd, update.args, { pm })
      const install = installArgs(pm, missing)
      await shElevated(emit, install.cmd, install.args, { pm })
      if (dnsMode === 'safe' && !existsSync('/usr/sbin/dnsmasq')) {
        throw new Error('No se instaló dnsmasq-base; elige el modo hosts o instálalo a mano.')
      }
      const after = await scanPorts().catch(() => null)
      const bound = after?.usage.filter((u) => [80, 443].includes(u.port)) ?? []
      if (bound.length) {
        emit({ type: 'log', text: `Puertos en uso tras instalar: ${bound.map((u) => `${u.port} (${u.process})`).join(', ')}\n` })
      }
    }),
    S('helpers', 'Preparar ayudante de contraseña', async () => {
      await prepareHelpers()
      await prepareInstallScripts()
    }),
    S('composer', 'Instalar Valet con Composer aislado', async () => {
      if (existsSync(join(COMPOSER_BIN, 'valet'))) {
        emit({ type: 'log', text: 'Valet ya está en el Composer aislado.\n' })
        return 'skip'
      }
      await sh(emit, 'composer', ['global', 'require', pkg, '--no-interaction', '--no-progress'], {
        env: composerEnv()
      })
      if (!existsSync(join(COMPOSER_BIN, 'valet'))) throw new Error('Composer no creó el binario valet en el home aislado.')
    }),
    S('patch', 'Aplicar protección DNS a Valet', async () => {
      if (dnsMode === 'classic') return 'skip'
      await patchValetDns(pkg, emit)
    }),
    S('dns-cleanup', 'Retirar el DNS seguro anterior', async () => {
      if (dnsMode !== 'classic') return 'skip'
      await removeDns(emit)
    }),
    S('install', 'Configurar nginx y PHP-FPM', async () => {
      await sh(emit, 'valet', ['install'], {
        extraEnv: { VALET_DASHBOARD_SAFE_DNS: dnsMode === 'classic' ? '0' : '1' }
      })
      try {
        await shElevated(emit, 'nginx', ['-t'])
      } catch (e) {
        throw new Error(`La configuración de nginx no es válida: ${(e as Error).message}`)
      }
    }),
    S('park', 'Registrar carpeta de proyectos', async () => {
      await mkdir(parkDir, { recursive: true })
      await sh(emit, 'valet', ['park'], { cwd: parkDir })
    }),
    S('dns', 'Configurar DNS de los sitios', () => applyDns(emit, dnsMode)),
    S('verify', 'Verificar instalación', async () => {
      const version = (await runValet(['--version'], true)).trim()
      if (!version) throw new Error('No se pudo ejecutar Valet después de la instalación.')
      if (!existsSync('/usr/local/bin/valet')) throw new Error('Valet no creó /usr/local/bin/valet; revisa los permisos de /usr/local/bin.')
      if (!(await active('nginx'))) throw new Error('nginx no está activo. Revisa si otro servicio ocupa los puertos 80/443.')
      const php = await phpInfo().catch(() => null)
      if (php?.versions.length) {
        const fpmActive = (await Promise.all(php.versions.map((v) => active(`php${v}-fpm`)))).some(Boolean)
        if (!fpmActive) throw new Error('No hay ningún PHP-FPM activo; revisa php-fpm con systemctl.')
      }
      if (dnsMode === 'safe') {
        if (!(await active('valet-dashboard-dns'))) throw new Error('El servicio DNS seguro no está activo.')
        if (!(await active('systemd-resolved'))) throw new Error('systemd-resolved no está activo.')
      }
      const domain = await valetDomain().catch(() => 'test')
      const check = await run('getent', ['hosts', `valet-dashboard.${domain}`], true)
      if (!check.includes('127.0.0.1')) throw new Error(`No se pudo resolver valet-dashboard.${domain}.`)
      emit({ type: 'log', text: `Valet listo: ${version.split('\n')[0]}\n` })
    }),
    S('smoke', 'Probar un sitio de extremo a extremo', async () => { await smokeTest(parkDir, emit) })
  ], emit)
}

export async function startUninstall(pkgInput: string, emit: Emit) {
  const pkg = normalizePkg(pkgInput)
  await requireElevation()
  await prepareInstallScripts()
  await prepareHelpers()
  const isolatedValet = existsSync(join(COMPOSER_BIN, 'valet'))

  await runSteps([
    {
      id: 'valet',
      label: 'Desinstalar servicios de Valet',
      fn: async () => {
        if (!isolatedValet) {
          if (await has('valet')) throw new Error('Hay un Valet externo; no se desinstala automáticamente desde el dashboard.')
          return 'skip'
        }
        await patchValetDns(pkg, emit)
        await sh(emit, 'valet', ['uninstall'], { extraEnv: { VALET_DASHBOARD_SAFE_DNS: '1' } })
      }
    },
    { id: 'dns', label: 'Eliminar DNS del dashboard', fn: () => removeDns(emit) },
    {
      id: 'composer',
      label: 'Quitar paquete de Composer aislado',
      fn: async () => {
        const [vendor, name] = pkg.split('/')
        if (!existsSync(join(COMPOSER_HOME, 'vendor', vendor, name))) return 'skip'
        await sh(emit, 'composer', ['global', 'remove', pkg, '--no-interaction', '--no-progress'], {
          env: composerEnv()
        })
      }
    }
  ], emit)
}

export async function repairDns(mode: DnsMode, emit: Emit) {
  if (mode !== 'safe' && mode !== 'hosts') throw new Error('Modo DNS no válido para reparación')
  await requireElevation()
  await prepareInstallScripts()
  await prepareHelpers()
  await runSteps([
    {
      id: 'dns',
      label: mode === 'safe' ? 'Aplicar DNS seguro' : 'Sincronizar /etc/hosts',
      fn: () => applyDns(emit, mode)
    }
  ], emit)
}

export async function syncHosts(emit: Emit) {
  await repairDns('hosts', emit)
}
