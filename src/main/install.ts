import { homedir } from 'node:os'
import { join, isAbsolute, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import type { DnsMode, Env, InstallEvent, InstallOptions } from '../shared/types'
import { APP_DIR, COMPOSER_BIN, COMPOSER_HOME, run } from './exec'
import { BACKUP_SCRIPT, DNS_SCRIPT } from './root-scripts'
import {
  ROOT_HELPER_DIR, USER_NAME, installRootHelper, prepareHelpers, privilegedEnv, runValet, unprivilegedEnv
} from './helpers'
import { apacheInfo, listSites, phpInfo, scanPorts, valetDomain } from './valet'

const HOME = homedir()
const PKG_RE = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i
const DNS_MODES: DnsMode[] = ['safe', 'hosts', 'classic']
const DNS_PORT = 5354
const DNS_HELPER = join(ROOT_HELPER_DIR, 'dns-helper.sh')
const BACKUP_HELPER = join(ROOT_HELPER_DIR, 'backup.sh')
let busy = false

type PkgManager = 'apt' | 'dnf' | 'pacman'
type Emit = (e: InstallEvent) => void
type Step = { id: string; label: string; fn: () => Promise<'skip' | void> }

async function distro(): Promise<{ id: string; pm: PkgManager | null }> {
  const t = await readFile('/etc/os-release', 'utf8').catch(() => '')
  const get = (k: string) => (t.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').replace(/"/g, '')
  const s = `${get('ID')} ${get('ID_LIKE')}`
  const pm: PkgManager | null = /debian|ubuntu/.test(s) ? 'apt' : /fedora|rhel|centos/.test(s) ? 'dnf' : /arch/.test(s) ? 'pacman' : null
  return { id: get('PRETTY_NAME') || get('NAME') || get('ID') || 'desconocida', pm }
}

const has = async (c: string) => (await run('which', [c], true)).trim() !== ''
const active = async (service: string) => (await run('systemctl', ['is-active', service], true)).trim() === 'active'

async function phpVersion(): Promise<string | null> {
  const v = (await run('php', ['-r', 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;'], true)).trim()
  return /^\d+\.\d+$/.test(v) ? v : null
}

const unique = (values: string[]) => [...new Set(values)]

async function packages(pm: PkgManager): Promise<{ cmd: string; args: string[] }> {
  const php = await phpVersion()
  const base = ['curl', 'git', 'unzip', 'jq', 'xsel', 'zenity']
  if (pm === 'apt') {
    const phpPackages = php
      ? [`php${php}-cli`, `php${php}-fpm`, `php${php}-curl`, `php${php}-mbstring`, `php${php}-xml`, `php${php}-zip`, `php${php}-mysql`]
      : ['php-cli', 'php-fpm', 'php-curl', 'php-mbstring', 'php-xml', 'php-zip', 'php-mysql']
    return {
      cmd: 'env',
      args: ['DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y',
        ...unique([...base, 'libnss3-tools', 'dnsmasq-base', 'nginx', 'composer', ...phpPackages])]
    }
  }
  if (pm === 'dnf') {
    return {
      cmd: 'dnf',
      args: ['install', '-y', ...unique([...base, 'nss-tools', 'dnsmasq', 'nginx', 'composer',
        'php-cli', 'php-fpm', 'php-mbstring', 'php-xml', 'php-mysqlnd'])]
    }
  }
  return {
    cmd: 'pacman',
    args: ['-S', '--needed', '--noconfirm', ...unique([...base, 'nss', 'dnsmasq', 'nginx', 'composer', 'php'])]
  }
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

type ShOptions = { cwd?: string; extraEnv?: NodeJS.ProcessEnv; env?: NodeJS.ProcessEnv }

/**
 * Composer ejecuta scripts y plugins de paquetes de terceros: su entorno no
 * incluye el ayudante `sudo` ni `SUDO_ASKPASS` que sí usa Valet.
 */
const composerEnv = (): NodeJS.ProcessEnv =>
  unprivilegedEnv({ COMPOSER_HOME, COMPOSER_NO_INTERACTION: '1' })

function sh(emit: Emit, cmd: string, args: string[], opts: ShOptions = {}): Promise<void> {
  emit({ type: 'log', text: `$ ${cmd} ${args.join(' ')}\n` })
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { env: opts.env ?? privilegedEnv(opts.extraEnv), cwd: opts.cwd })
    const out = (b: Buffer) => emit({ type: 'log', text: b.toString() })
    c.stdout.on('data', out)
    c.stderr.on('data', out)
    c.on('error', reject)
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} terminó con código ${code}`))))
  })
}

async function runSteps(steps: Step[], emit: Emit) {
  if (busy) throw new Error('Ya hay una operación en curso')
  busy = true
  try {
    emit({ type: 'plan', steps: steps.map(({ id, label }) => ({ id, label })) })
    for (const s of steps) {
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
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function backupSystem(emit: Emit): Promise<string> {
  const dest = join(APP_DIR, 'backups', stamp(), 'system')
  if (!dest.startsWith(APP_DIR + sep)) throw new Error('Ruta de copia de seguridad no válida')
  await mkdir(APP_DIR, { recursive: true })
  await run('pkexec', [BACKUP_HELPER, dest, USER_NAME])
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

async function patchValetDns(pkg: string, emit: Emit) {
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
  await run('pkexec', [DNS_HELPER, mode, domain, backupDir, hostsFile, USER_NAME])
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
  await run('pkexec', [DNS_HELPER, 'remove', domain, backupDir, '', USER_NAME])
  emit({ type: 'log', text: 'DNS del dashboard eliminado.\n' })
}

async function requirePkexec() {
  if (!(await has('pkexec'))) throw new Error('Falta pkexec (polkit); instálalo para autenticar los cambios de red.')
}

export async function checkEnv(): Promise<Env> {
  const d = await distro()
  const toolNames = ['php', 'composer', 'valet', 'nginx', 'dnsmasq', 'nmcli', 'certutil', 'xsel', 'pkexec', 'sudo', 'zenity']
  const tools: Record<string, boolean> = {}
  await Promise.all(toolNames.map(async (t) => { tools[t] = await has(t) }))

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
  if (!d.pm) warnings.push('Distribución no soportada para instalar dependencias automáticamente.')

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

export async function startInstall(o: InstallOptions, emit: Emit) {
  if (!o || typeof o !== 'object') throw new Error('Opciones de instalación no válidas')
  const pkg = normalizePkg(o.pkg)
  const dnsMode = normalizeDnsMode(o.dnsMode)
  const parkDir = resolveParkDir(o.parkDir)
  const d = await distro()
  if (!d.pm) throw new Error(`Distribución no soportada: ${d.id}. Instala las dependencias a mano.`)
  await prepareHelpers()
  await prepareInstallScripts()

  const S = (id: string, label: string, fn: Step['fn']): Step => ({ id, label, fn })
  let preflight: Env | undefined

  await runSteps([
    S('preflight', 'Comprobar puertos, red y DNS', async () => {
      const info = await checkEnv()
      preflight = info
      if (info.portHogs.length && !(o.stopApache && info.portHogs.every((h) => /apache/i.test(h)))) {
        throw new Error(`Libera los puertos 80/443 antes de instalar: ${info.portHogs.join(', ')}`)
      }
      if (dnsMode === 'safe') {
        if (!info.dns.resolvedActive) throw new Error('systemd-resolved no está activo; elige el modo hosts o actívalo antes.')
        if (!info.dns.portFree) throw new Error(`El puerto ${DNS_PORT} está ocupado; elige el modo hosts.`)
        if (!info.dns.dnsmasqBinary && info.pm !== 'apt') throw new Error('Falta dnsmasq; instálalo o usa el modo hosts.')
        if (!info.dns.resolvConfOk) throw new Error('/etc/resolv.conf no apunta a systemd-resolved; elige el modo hosts.')
      }
      if (!info.tools.pkexec) throw new Error('Falta pkexec (polkit); instálalo para autenticar la instalación.')
    }),
    S('backup', 'Crear copia de seguridad', async () => { await backupSystem(emit) }),
    S('apache', 'Liberar los puertos 80/443 (Apache)', async () => {
      if (!o.stopApache) return 'skip'
      const apache = await apacheInfo()
      const apacheHog = preflight?.portHogs.some((h) => /apache/i.test(h)) ?? false
      if (!apache.active || (!apacheHog && ![apache.http, apache.https].some((p) => p === 80 || p === 443))) return 'skip'
      await sh(emit, 'pkexec', ['systemctl', 'disable', '--now', 'apache2'])
    }),
    S('apt-update', 'Actualizar índices del sistema', async () => {
      if (d.pm !== 'apt') return 'skip'
      await sh(emit, 'pkexec', ['env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'update'])
    }),
    S('deps', 'Instalar dependencias del sistema', async () => {
      const p = await packages(d.pm as PkgManager)
      await sh(emit, 'pkexec', [p.cmd, ...p.args])
      if (dnsMode === 'safe' && !existsSync('/usr/sbin/dnsmasq')) {
        throw new Error('No se instaló dnsmasq-base; elige el modo hosts o instálalo a mano.')
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
    })
  ], emit)
}

export async function startUninstall(pkgInput: string, emit: Emit) {
  const pkg = normalizePkg(pkgInput)
  await requirePkexec()
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
  await requirePkexec()
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
