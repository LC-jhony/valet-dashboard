import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, appendFile, chmod } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import type { Env, InstallEvent, InstallOptions } from '../shared/types'
import { env, run } from './exec'
import { apacheInfo, scanPorts } from './valet'

const HOME = homedir()
const BIN = join(HOME, '.valet-dashboard', 'bin')
const PKG_RE = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i
let busy = false

const PM: Record<string, string[]> = {
  apt: ['env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', 'curl', 'git', 'unzip', 'jq', 'xsel',
    'libnss3-tools', 'network-manager', 'php-cli', 'php-fpm', 'php-curl', 'php-mbstring', 'php-xml', 'php-zip', 'php-mysql', 'composer'],
  dnf: ['dnf', 'install', '-y', 'curl', 'git', 'unzip', 'jq', 'xsel', 'nss-tools', 'NetworkManager',
    'php-cli', 'php-fpm', 'php-mbstring', 'php-xml', 'php-mysqlnd', 'composer'],
  pacman: ['pacman', '-S', '--needed', '--noconfirm', 'curl', 'git', 'unzip', 'jq', 'xsel', 'nss', 'networkmanager',
    'php', 'php-fpm', 'composer']
}

async function distro() {
  const t = await readFile('/etc/os-release', 'utf8').catch(() => '')
  const get = (k: string) => (t.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').replace(/"/g, '')
  const s = `${get('ID')} ${get('ID_LIKE')}`
  const pm = /debian|ubuntu/.test(s) ? 'apt' : /fedora|rhel|centos/.test(s) ? 'dnf' : /arch/.test(s) ? 'pacman' : null
  return { id: get('NAME') || get('ID') || 'desconocida', pm }
}

const has = async (c: string) => (await run('which', [c], true)).trim() !== ''

export async function checkEnv(): Promise<Env> {
  const d = await distro()
  const tools: Record<string, boolean> = {}
  for (const t of ['php', 'composer', 'valet', 'nginx', 'dnsmasq', 'nmcli']) tools[t] = await has(t)
  const { usage, nginxActive } = await scanPorts()
  const portHogs = usage
    .filter((u) => [80, 443].includes(u.port) && u.process !== 'nginx' && !(u.process === '—' && nginxActive))
    .map((u) => `${u.port}: ${u.process === '—' ? 'proceso de otro usuario' : u.process}`)
  return { distro: d.id, pm: d.pm, tools, portHogs }
}

type Emit = (e: InstallEvent) => void
type Step = { id: string; label: string; fn: () => Promise<'skip' | void> }

const vEnv = () => ({ ...env, PATH: `${BIN}:${env.PATH}`, SUDO_ASKPASS: join(BIN, 'askpass') })

function sh(emit: Emit, cmd: string, args: string[], cwd?: string): Promise<void> {
  emit({ type: 'log', text: `$ ${cmd} ${args.join(' ')}\n` })
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { env: vEnv(), cwd })
    const out = (b: Buffer) => emit({ type: 'log', text: b.toString() })
    c.stdout.on('data', out); c.stderr.on('data', out)
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
      try { emit({ type: 'step', id: s.id, status: (await s.fn()) === 'skip' ? 'skip' : 'ok' }) }
      catch (e) {
        emit({ type: 'step', id: s.id, status: 'fail' })
        emit({ type: 'log', text: `\n✖ ${(e as Error).message}\n` })
        throw e
      }
    }
  } finally { busy = false }
}

const checkPkg = (p: string) => { if (!PKG_RE.test(p)) throw new Error('Paquete de Composer no válido (vendor/nombre)') }

/** Ayudante que permite a Valet usar sudo sin terminal, pidiendo la contraseña en una ventana. */
async function prepareHelpers() {
  await mkdir(BIN, { recursive: true })
  await writeFile(join(BIN, 'askpass'), `#!/bin/sh
if command -v zenity >/dev/null 2>&1; then exec zenity --password --title="Valet Dashboard: contraseña de administrador"; fi
if command -v kdialog >/dev/null 2>&1; then exec kdialog --password "Contraseña de administrador"; fi
exit 1
`)
  await writeFile(join(BIN, 'sudo'), '#!/bin/sh\nexec /usr/bin/sudo -A "$@"\n')
  await chmod(join(BIN, 'askpass'), 0o755); await chmod(join(BIN, 'sudo'), 0o755)
}

async function addToPath(): Promise<'skip' | void> {
  const line = 'export PATH="$PATH:$HOME/.config/composer/vendor/bin:$HOME/.composer/vendor/bin" # valet-dashboard'
  let changed = false
  for (const rc of ['.bashrc', '.zshrc']) {
    const f = join(HOME, rc)
    if (!existsSync(f) || (await readFile(f, 'utf8')).includes('# valet-dashboard')) continue
    await appendFile(f, `\n${line}\n`); changed = true
  }
  return changed ? undefined : 'skip'
}

export async function startInstall(o: InstallOptions, emit: Emit) {
  checkPkg(o.pkg)
  const parkDir = o.parkDir || join(HOME, 'Sites')
  if (!isAbsolute(parkDir)) throw new Error('La carpeta de proyectos debe ser una ruta absoluta')
  const { pm, id } = await distro()
  if (!pm) throw new Error(`Distribución no soportada: ${id}. Instala las dependencias a mano.`)
  const S = (id: string, label: string, fn: Step['fn']): Step => ({ id, label, fn })
  await runSteps([
    S('apache', 'Liberar los puertos 80/443 (Apache)', async () => {
      if (!o.stopApache) return 'skip'
      const apache = await apacheInfo()
      if (!apache.active || ![apache.http, apache.https].some((p) => p === 80 || p === 443)) return 'skip'
      await sh(emit, 'pkexec', ['systemctl', 'disable', '--now', 'apache2'])
    }),
    S('deps', 'Instalar dependencias del sistema', () => sh(emit, 'pkexec', PM[pm])),
    S('helpers', 'Preparar ayudante de contraseña', prepareHelpers),
    S('composer', 'Instalar Valet con Composer', async () => {
      if (await has('valet')) { emit({ type: 'log', text: 'Valet ya está instalado.\n' }); return 'skip' }
      await sh(emit, 'composer', ['global', 'require', o.pkg, '--no-interaction'])
    }),
    S('path', 'Añadir Valet al PATH', addToPath),
    S('trust', 'Permitir comandos de Valet sin contraseña', () => sh(emit, 'valet', ['trust'])),
    S('install', 'Configurar nginx, PHP-FPM y DNS', () => sh(emit, 'valet', ['install'])),
    S('park', 'Registrar carpeta de proyectos', async () => {
      await mkdir(parkDir, { recursive: true })
      await sh(emit, 'valet', ['park'], parkDir)
    }),
    S('verify', 'Verificar instalación', async () => {
      await sh(emit, 'valet', ['--version'])
      if ((await run('systemctl', ['is-active', 'nginx'], true)).trim() !== 'active')
        throw new Error('nginx no está activo. Revisa si otro servicio ocupa los puertos 80/443.')
    })
  ], emit)
}

export async function startUninstall(pkg: string, emit: Emit) {
  checkPkg(pkg)
  await prepareHelpers()
  await runSteps([
    { id: 'un', label: 'Desinstalar servicios de Valet', fn: () => sh(emit, 'valet', ['uninstall', '--force']) },
    { id: 'rm', label: 'Quitar paquete de Composer', fn: () => sh(emit, 'composer', ['global', 'remove', pkg, '--no-interaction']) }
  ], emit)
}
