// Requisitos que el panel no puede resolver por sí mismo: systemd, elevación,
// sudo, diálogo de contraseña, paquetes del sistema, red y disco. Este módulo es
// puro a propósito: recibe una foto del sistema y devuelve qué falta, por qué y
// el comando exacto que lo arregla. Así se puede probar sin tocar la máquina.
import type { Prereq, PrereqId } from '../shared/types'

export type Pm = 'apt' | 'dnf' | 'pacman'

/** Herramientas que necesitan Valet y el panel para funcionar. */
export const REQUIRED_TOOLS = [
  'php', 'composer', 'nginx', 'certutil', 'xsel', 'jq', 'git', 'unzip'
] as const

export interface PrereqProbe {
  pm: Pm | null
  systemd: boolean
  /** Hay sesión gráfica: sin ella no se puede pedir la contraseña. */
  graphical: boolean
  diskFreeMb: number
  /** `null` cuando no se pudo comprobar. */
  network: boolean | null
  tools: Record<string, boolean>
}

const MIRRORS: Record<Pm, string> = {
  apt: 'deb.debian.org',
  dnf: 'mirrors.fedoraproject.org',
  pacman: 'archlinux.org'
}

const unique = (values: string[]): string[] => [...new Set(values)]

/** Host que se consulta por DNS para saber si hay red hacia el repositorio. */
export const mirrorHost = (pm: Pm | null): string => (pm ? MIRRORS[pm] : 'deb.debian.org')

/** Paquetes que el instalador pide al gestor de la distribución. */
export function requiredPackages(pm: Pm, php: string | null): string[] {
  const base = ['curl', 'git', 'unzip', 'jq', 'xsel', 'zenity']
  if (pm === 'apt') {
    const phpPackages = php
      ? [`php${php}-cli`, `php${php}-fpm`, `php${php}-curl`, `php${php}-mbstring`, `php${php}-xml`, `php${php}-zip`, `php${php}-mysql`, `php${php}-sqlite3`]
      : ['php-cli', 'php-fpm', 'php-curl', 'php-mbstring', 'php-xml', 'php-zip', 'php-mysql', 'php-sqlite3']
    return unique([...base, 'libnss3-tools', 'dnsmasq-base', 'nginx', 'composer', ...phpPackages])
  }
  if (pm === 'dnf') {
    // `php-process` aporta ext-posix, que Valet declara como obligatoria.
    // `php-pdo` incluye el controlador de SQLite que usa Laravel por defecto.
    return unique([...base, 'nss-tools', 'dnsmasq', 'nginx', 'composer',
      'php-cli', 'php-fpm', 'php-mbstring', 'php-xml', 'php-mysqlnd', 'php-process', 'php-pdo'])
  }
  return unique([...base, 'nss', 'dnsmasq', 'nginx', 'composer', 'php'])
}

/** Comando e instrucciones para instalar una lista de paquetes. */
export function installArgs(pm: Pm, packages: string[]): { cmd: string; args: string[] } {
  if (pm === 'apt') {
    return { cmd: 'env', args: ['DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', ...packages] }
  }
  if (pm === 'dnf') return { cmd: 'dnf', args: ['install', '-y', ...packages] }
  return { cmd: 'pacman', args: ['-S', '--needed', '--noconfirm', ...packages] }
}

/** Actualiza los índices antes de instalar. pacman no tiene equivalente seguro. */
export function updateArgs(pm: Pm): { cmd: string; args: string[] } | null {
  if (pm === 'apt') return { cmd: 'env', args: ['DEBIAN_FRONTEND=noninteractive', 'apt-get', 'update'] }
  if (pm === 'dnf') return { cmd: 'dnf', args: ['makecache', '--refresh'] }
  return null
}

/** Consulta que lista qué paquetes de la lista no están instalados. */
export function missingQuery(pm: Pm, packages: string[]): { cmd: string; args: string[] } {
  if (pm === 'apt') return { cmd: 'dpkg-query', args: ['-W', '-f=${Package}\t${Status}\n', ...packages] }
  if (pm === 'dnf') return { cmd: 'rpm', args: ['-q', '--qf', '%{NAME}\n', ...packages] }
  return { cmd: 'pacman', args: ['-T', ...packages] }
}

/** Interpreta la salida de {@link missingQuery} y devuelve los que faltan. */
export function parseMissing(pm: Pm, packages: string[], stdout: string): string[] {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  if (pm === 'pacman') return packages.filter((p) => lines.includes(p))
  if (pm === 'apt') {
    const installed = new Set(lines.filter((l) => /install ok installed/.test(l)).map((l) => l.split('\t')[0]))
    return packages.filter((p) => !installed.has(p))
  }
  const missing = new Set(lines.filter((l) => /^package .* is not installed/.test(l)).map((l) => l.split(' ')[1]))
  return packages.filter((p) => missing.has(p) || !lines.includes(p))
}

const installHint = (pm: Pm | null, packages: string): string[] => {
  if (pm === 'apt') return [`sudo apt-get install -y ${packages}`]
  if (pm === 'dnf') return [`sudo dnf install -y ${packages}`]
  if (pm === 'pacman') return [`sudo pacman -S --needed ${packages}`]
  return []
}

/** Comandos que el usuario puede copiar en una terminal para resolver el requisito. */
export function fixCommands(pm: Pm | null, id: PrereqId): string[] {
  switch (id) {
    case 'systemd':
      return []
    case 'elevation':
      return installHint(pm, pm === 'apt' ? 'policykit-1' : 'polkit')
    case 'sudo':
      return installHint(pm, 'sudo')
    case 'askpass':
      return installHint(pm, 'zenity')
    case 'packages': {
      if (!pm) return []
      const update = updateArgs(pm)
      // `sudo env VAR=x cmd`: `sudo VAR=x` no funciona, sudo lo trata como comando.
      const refresh = update ? [`sudo ${[update.cmd, ...update.args].join(' ')}`] : []
      return [...refresh, ...installHint(pm, requiredPackages(pm, null).join(' '))]
    }
    case 'network':
      return [`ping -c 1 1.1.1.1`, `ping -c 1 ${mirrorHost(pm)}`]
    case 'disk':
      return ['df -h ~', 'du -sh ~/.cache/* 2>/dev/null | sort -h | tail -10']
  }
}

const missingTools = (tools: Record<string, boolean>): string[] =>
  REQUIRED_TOOLS.filter((t) => !tools[t])

/**
 * Evalúa los requisitos. `blocking` solo se marca cuando el panel no puede
 * resolverlo durante la instalación.
 */
export function evaluate(p: PrereqProbe): Prereq[] {
  const t = p.tools
  const hasPkexec = Boolean(t.pkexec)
  const hasSudo = Boolean(t.sudo)
  const hasAskpass = Boolean(t.zenity || t.kdialog)
  const elevationOk = hasPkexec || (hasSudo && hasAskpass)
  const missing = missingTools(t)
  const packagesOk = missing.length === 0

  const elevationCommands = elevationOk
    ? []
    : [
        ...(hasAskpass ? [] : fixCommands(p.pm, 'askpass')),
        ...(hasPkexec ? [] : fixCommands(p.pm, 'elevation')),
        ...(hasSudo ? [] : fixCommands(p.pm, 'sudo'))
      ]

  return [
    {
      id: 'systemd',
      label: 'systemd',
      ok: p.systemd,
      blocking: !p.systemd,
      detail: p.systemd
        ? 'The system uses systemd for its services.'
        : 'systemd was not detected. The panel cannot manage nginx, PHP-FPM or DNS without it.',
      commands: []
    },
    {
      id: 'elevation',
      label: 'Privilege elevation',
      ok: elevationOk,
      blocking: !elevationOk,
      detail: hasPkexec
        ? `polkit (pkexec) available.${p.graphical ? '' : ' No graphical session: the dialog cannot be shown.'}`
        : hasSudo && hasAskpass
          ? 'polkit is missing; sudo will be used with the zenity or kdialog prompt.'
          : hasSudo
            ? 'sudo is present, but a password dialog (zenity or kdialog) is missing.'
            : 'There is no pkexec or sudo: the administrator password cannot be requested.',
      commands: elevationCommands
    },
    {
      id: 'sudo',
      label: 'sudo',
      ok: hasSudo,
      blocking: !hasSudo,
      detail: hasSudo
        ? 'Valet elevates its own commands with /usr/bin/sudo.'
        : 'Valet needs /usr/bin/sudo to configure nginx and PHP-FPM.',
      commands: hasSudo ? [] : fixCommands(p.pm, 'sudo')
    },
    {
      id: 'askpass',
      label: 'Password prompt',
      ok: hasAskpass,
      blocking: !hasAskpass,
      detail: hasAskpass
        ? `${t.zenity ? 'zenity' : 'kdialog'} will be used to ask for the password.`
        : 'zenity or kdialog is missing: without them nobody can type the administrator password.',
      commands: hasAskpass ? [] : fixCommands(p.pm, 'askpass')
    },
    {
      id: 'packages',
      label: 'System packages',
      ok: packagesOk,
      blocking: !packagesOk && !p.pm,
      detail: packagesOk
        ? 'PHP, Composer, nginx and the rest of the tools are installed.'
        : p.pm
          ? `Missing: ${missing.join(', ')}. The installer adds them with ${p.pm}.`
          : `Missing: ${missing.join(', ')} and there is no compatible package manager.`,
      commands: packagesOk ? [] : fixCommands(p.pm, 'packages')
    },
    {
      id: 'network',
      label: 'Network',
      ok: p.network !== false,
      blocking: false,
      detail: p.network === null
        ? `Could not check resolution of ${mirrorHost(p.pm)}.`
        : p.network
          ? `${mirrorHost(p.pm)} resolves.`
          : `${mirrorHost(p.pm)} does not resolve: no network means no downloads.`,
      commands: p.network === false ? fixCommands(p.pm, 'network') : []
    },
    {
      id: 'disk',
      label: 'Disk space',
      ok: p.diskFreeMb >= 2000,
      blocking: p.diskFreeMb < 500,
      detail: `${Math.max(0, Math.round(p.diskFreeMb))} MB free in your home folder.`,
      commands: p.diskFreeMb < 2000 ? fixCommands(p.pm, 'disk') : []
    }
  ]
}

/** ¿Hay algún requisito bloqueante sin resolver? */
export const hasBlocking = (prereqs: Prereq[]): boolean => prereqs.some((p) => !p.ok && p.blocking)
