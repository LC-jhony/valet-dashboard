// Comprobación y aplicación de actualizaciones de los programas que rodean a
// Valet. Hay dos fuentes: el gestor de paquetes del sistema (PHP, nginx,
// dnsmasq, Node del sistema y Composer si lo instaló el sistema) y Composer
// aislado (Composer mismo y el paquete de Valet del panel). Lo que el panel no
// puede tocar —un Valet externo, Node bajo nvm— se explica en vez de fingir un
// botón. Los parsers son puros para poder probarlos sin tocar la máquina.
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { UpdateId, UpdateItem, UpdatesInfo } from '../shared/types'
import { COMPOSER_BIN, run, runCapture } from './exec'
import { detectElevation } from './elevate'
import {
  composerEnv, distro, patchValetDns, runSteps, sh, shElevated, type Emit, type Step
} from './install'
import type { Pm } from './prereqs'

const VALET_PKG = 'cpriego/valet-linux'
const CHECK_TTL_MS = 60_000
const COMPOSER_VERSIONS_URL = 'https://getcomposer.org/versions'
const NODE_INDEX_URL = 'https://nodejs.org/dist/index.json'
const PACKAGIST_URL = `https://repo.packagist.org/p2/${VALET_PKG}.json`

const KNOWN: UpdateId[] = ['php', 'nginx', 'dnsmasq', 'composer', 'valet', 'node']

export interface PackageUpdate {
  /** Versión instalada; vacía si el gestor no la dice. */
  current: string
  latest: string
}

/** `apt list --upgradable` con LC_ALL=C. */
export function parseAptUpgradable(text: string): Record<string, PackageUpdate> {
  const out: Record<string, PackageUpdate> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^([^\s/]+)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from:\s*([^\]]+)\]/i)
    if (m) out[m[1]] = { latest: m[2], current: m[3].trim() }
  }
  return out
}

/** `dnf check-update`: la versión instalada no aparece, solo la disponible. */
export function parseDnfCheckUpdate(text: string): Record<string, PackageUpdate> {
  const out: Record<string, PackageUpdate> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || /^(last metadata|obsoleting|security:)/i.test(line)) continue
    const m = line.match(/^(\S+)\.(?:x86_64|i686|aarch64|noarch|armv7hl|ppc64le|s390x)\s+(\S+)\s+\S+$/i)
    if (m) out[m[1]] = { latest: m[2], current: '' }
  }
  return out
}

/** `pacman -Qu` sí da las dos versiones: `nginx 1.26.2-1 -> 1.27.0-1`. */
export function parsePacmanQu(text: string): Record<string, PackageUpdate> {
  const out: Record<string, PackageUpdate> = {}
  for (const raw of text.split('\n')) {
    const m = raw.trim().match(/^(\S+)\s+(\S+)\s+->\s+(\S+)$/)
    if (m) out[m[1]] = { current: m[2], latest: m[3] }
  }
  return out
}

/** Parte «de programa» de una versión de paquete: `1:8.5.4-1ubuntu1` → `8.5.4`. */
export function upstream(version: string): string {
  return version.trim().replace(/^\d+:/, '').replace(/^v/i, '').split(/[-+~]/)[0]
}

/** ¿`candidate` es más nueva que `current`? Compara los tramos numéricos. */
export function isNewer(candidate: string, current: string): boolean {
  const nums = (v: string): number[] => upstream(v)
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((n) => Number.isFinite(n))
  const a = nums(candidate)
  const b = nums(current)
  if (!a.length || !b.length) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

export const parseComposerVersion = (text: string): string =>
  text.match(/Composer\s+(?:version\s+)?(\d+\.\d+(?:\.\d+)?)/i)?.[1] ?? ''

/** `Valet v2.4.5` y también `Laravel Valet 3.7.0`. */
export const parseValetVersion = (text: string): string =>
  text.match(/Valet[^\d]*(\d+\.\d+(?:\.\d+)?)/i)?.[1] ?? ''

export const parseNginxVersion = (text: string): string =>
  text.match(/nginx\/(\d+\.\d+(?:\.\d+)?)/i)?.[1] ?? ''

/** El binario está localizado: acepta «version» y «versión». */
export const parseDnsmasqVersion = (text: string): string =>
  text.match(/Dnsmasq\s+(?:version|versión)\s+(\S+)/i)?.[1] ?? ''

export const parseNodeVersion = (text: string): string =>
  text.match(/v?(\d+\.\d+\.\d+)/)?.[1] ?? ''

export function latestComposerVersion(json: string): string {
  try {
    const data = JSON.parse(json) as { stable?: { version?: string }[] }
    return data.stable?.[0]?.version ?? ''
  } catch {
    return ''
  }
}

export function latestPackagistVersion(json: string): string {
  try {
    const data = JSON.parse(json) as { packages?: Record<string, { version?: string }[]> }
    return data.packages?.[VALET_PKG]?.[0]?.version ?? ''
  } catch {
    return ''
  }
}

/** Primera versión LTS del índice de Node. */
export function latestNodeLts(json: string): string {
  try {
    const list = JSON.parse(json) as { version?: string; lts?: string | false }[]
    return list.find((r) => typeof r.version === 'string' && r.lts)?.version ?? ''
  } catch {
    return ''
  }
}

/** Argumentos para subir solo los paquetes indicados. */
export function upgradeArgs(pm: Pm, packages: string[]): { cmd: string; args: string[] } {
  if (pm === 'apt') {
    return {
      cmd: 'env',
      args: ['DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '--only-upgrade', ...packages]
    }
  }
  if (pm === 'dnf') return { cmd: 'dnf', args: ['upgrade', '-y', ...packages] }
  return { cmd: 'pacman', args: ['-S', '--noconfirm', ...packages] }
}

const which = async (cmd: string): Promise<string> => (await run('which', [cmd], true)).trim()

async function upgradable(pm: Pm): Promise<Record<string, PackageUpdate>> {
  if (pm === 'apt') {
    return parseAptUpgradable(await run('env', ['LC_ALL=C', 'apt', 'list', '--upgradable'], true))
  }
  if (pm === 'dnf') {
    return parseDnfCheckUpdate(await run('env', ['LC_ALL=C', 'dnf', '-q', 'check-update'], true))
  }
  return parsePacmanQu(await run('env', ['LC_ALL=C', 'pacman', '-Qu'], true))
}

/** El paquete que posee ese archivo, si lo instaló el gestor del sistema. */
async function managedByPm(pm: Pm | null, path: string): Promise<boolean> {
  if (!pm || !path) return false
  const query = pm === 'apt'
    ? { cmd: 'dpkg-query', args: ['-S', path] }
    : pm === 'dnf'
      ? { cmd: 'rpm', args: ['-qf', path] }
      : { cmd: 'pacman', args: ['-Qo', path] }
  return (await run(query.cmd, query.args, true)).trim() !== ''
}

const writable = async (path: string): Promise<boolean> =>
  path ? access(path, constants.W_OK).then(() => true).catch(() => false) : false

async function readVersion(id: UpdateId): Promise<string> {
  switch (id) {
    case 'php':
      return (await run('php', ['-r', 'echo PHP_VERSION;'], true)).trim()
    case 'nginx': {
      const { stdout, stderr } = await runCapture('nginx', ['-v'], true)
      return parseNginxVersion(stderr || stdout)
    }
    case 'dnsmasq': {
      const { stdout, stderr } = await runCapture('dnsmasq', ['--version'], true)
      return parseDnsmasqVersion(`${stderr}${stdout}`)
    }
    case 'node':
      return parseNodeVersion((await run('node', ['-v'], true)).trim())
    case 'composer':
      return parseComposerVersion(await run('composer', ['--version'], true))
    case 'valet':
      return parseValetVersion(await run('valet', ['--version'], true))
  }
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/** Elige, entre las versiones nuevas, la más alta. */
function newest(versions: string[]): string {
  return versions.reduce<string>((best, v) => (!best || isNewer(v, best) ? v : best), '')
}

let cache: { at: number; info: UpdatesInfo } | null = null

/**
 * Foto de qué programas tienen versión nueva. Se cachea un minuto porque
 * consultar apt y tres servicios externos no es gratis.
 */
export async function checkUpdates(force = false): Promise<UpdatesInfo> {
  if (!force && cache && Date.now() - cache.at < CHECK_TTL_MS) return cache.info

  const d = await distro()
  const [elevation, composerPath, nodePath] = await Promise.all([
    detectElevation(),
    which('composer'),
    which('node')
  ])
  const isolated = await access(join(COMPOSER_BIN, 'valet'), constants.X_OK)
    .then(() => true).catch(() => false)
  const composerManaged = await managedByPm(d.pm, composerPath)
  const isNvm = /\/\.nvm\//.test(nodePath)

  const [up, php, nginx, dnsmasq, node, composer, valet] = await Promise.all([
    d.pm ? upgradable(d.pm) : Promise.resolve({} as Record<string, PackageUpdate>),
    readVersion('php'),
    readVersion('nginx'),
    readVersion('dnsmasq'),
    readVersion('node'),
    composerPath ? readVersion('composer') : Promise.resolve(''),
    readVersion('valet')
  ])

  // Solo se consulta internet para lo que de verdad se puede comparar.
  const [composerJson, nodeJson, packagistJson] = await Promise.all([
    composerPath && !composerManaged ? getText(COMPOSER_VERSIONS_URL) : Promise.resolve(null),
    isNvm ? getText(NODE_INDEX_URL) : Promise.resolve(null),
    valet ? getText(PACKAGIST_URL) : Promise.resolve(null)
  ])

  const warnings: string[] = []
  if (composerPath && !composerManaged && composerJson === null) {
    warnings.push('Could not fetch the latest Composer version.')
  }
  if (isNvm && nodeJson === null) warnings.push('Could not fetch the latest Node LTS version.')
  if (valet && packagistJson === null) warnings.push('Could not fetch the latest Valet version.')

  const items: UpdateItem[] = []

  /** Fila de un paquete del sistema, con sus paquetes actualizables. */
  const systemItem = (id: UpdateId, label: string, pattern: RegExp, current: string): UpdateItem | null => {
    if (!current) return null
    if (!d.pm) {
      return {
        id, label, current, latest: '', available: false, source: 'none', packages: [],
        blocked: 'No compatible package manager: the panel cannot check or upgrade this program.',
        needsElevation: false, commands: []
      }
    }
    const packages = Object.keys(up).filter((name) => pattern.test(name))
    const newer = newest(packages.map((name) => up[name].latest))
    const latest = newer ? (upstream(newer) === current ? newer : upstream(newer)) : current
    const command = packages.length ? upgradeArgs(d.pm, packages) : null
    return {
      id,
      label,
      current,
      latest,
      available: packages.length > 0,
      source: 'system',
      packages,
      blocked: packages.length > 0 && !elevation
        ? 'Upgrading needs a password and there is no way to ask for it (install pkexec, or sudo with zenity).'
        : '',
      needsElevation: true,
      commands: packages.length > 0 && !elevation && command
        ? [`sudo ${[command.cmd, ...command.args].join(' ')}`]
        : []
    }
  }

  items.push(...[
    systemItem('php', 'PHP', /^php(?:\d+(?:\.\d+)?)?-(?:cli|fpm|common)$/, php),
    systemItem('nginx', 'nginx', /^nginx(?:-core|-common)?$/, nginx),
    systemItem('dnsmasq', 'dnsmasq', /^dnsmasq(?:-base)?$/, dnsmasq)
  ].filter((i): i is UpdateItem => Boolean(i)))

  if (composer) {
    if (composerManaged) {
      const item = systemItem('composer', 'Composer', /^composer$/i, composer)
      if (item) items.push(item)
    } else {
      const latest = latestComposerVersion(composerJson ?? '') || composer
      const canWrite = await writable(composerPath)
      items.push({
        id: 'composer',
        label: 'Composer',
        current: composer,
        latest,
        available: isNewer(latest, composer),
        source: 'composer',
        packages: [],
        blocked: !canWrite && !elevation
          ? 'It needs to write to /usr/local/bin and there is no way to ask for the password.'
          : '',
        needsElevation: !canWrite,
        commands: !canWrite && !elevation
          ? [`sudo COMPOSER_ALLOW_SUPERUSER=1 ${composerPath || 'composer'} self-update`]
          : []
      })
    }
  }

  if (valet) {
    const latest = latestPackagistVersion(packagistJson ?? '') || valet
    items.push({
      id: 'valet',
      label: 'valet',
      current: valet,
      latest,
      available: isNewer(latest, valet),
      source: isolated ? 'composer' : 'none',
      packages: isolated ? [VALET_PKG] : [],
      blocked: isolated ? '' : 'It is installed outside the panel; upgrade it the same way you installed it.',
      needsElevation: false,
      commands: []
    })
  }

  if (node) {
    if (isNvm) {
      const latest = latestNodeLts(nodeJson ?? '') || node
      items.push({
        id: 'node',
        label: 'Node.js',
        current: node,
        latest,
        available: isNewer(latest, node),
        source: 'none',
        packages: [],
        blocked: 'Managed by nvm; the panel does not change it.',
        needsElevation: false,
        commands: ['nvm install --lts', 'nvm alias default lts/*']
      })
    } else {
      const item = systemItem('node', 'Node.js', /^nodejs$/, node)
      if (item) items.push(item)
    }
  }

  const info: UpdatesInfo = {
    items,
    checkedAt: Date.now(),
    warning: warnings.join(' ')
  }
  cache = { at: info.checkedAt, info }
  return info
}

/**
 * Actualiza un programa con el mismo panel de progreso de la instalación: los
 * eventos van por `install:event`, así que pasos y registro se reutilizan.
 */
export async function runUpdate(id: UpdateId, emit: Emit): Promise<void> {
  if (!KNOWN.includes(id)) throw new Error('Unknown program.')
  const info = await checkUpdates(true)
  const item = info.items.find((i) => i.id === id)
  if (!item) throw new Error('That program is not installed on this machine.')
  if (item.blocked) throw new Error(item.blocked)
  // valet can always be upgraded: it reinstalls the panel's isolated Valet and
  // reapplies the DNS patch.
  if (!item.available && id !== 'valet') throw new Error(`${item.label} is already up to date.`)

  const d = await distro()
  const steps: Step[] = []

  if (id === 'composer') {
    const path = await which('composer')
    if (!path) throw new Error('The Composer binary was not found.')
    steps.push({
      id: 'update',
      label: 'Upgrade Composer',
      fn: async () => {
        if (item.needsElevation) {
          await shElevated(emit, 'env', ['COMPOSER_ALLOW_SUPERUSER=1', path, 'self-update', '--no-interaction'])
        } else {
          await sh(emit, path, ['self-update', '--no-interaction'])
        }
      }
    })
  } else if (id === 'valet') {
    steps.push({
      id: 'update',
      label: 'Upgrade valet with Composer',
      fn: () => sh(emit, 'composer', ['global', 'update', VALET_PKG, '--no-interaction'], { env: composerEnv() })
    })
    // El paquete nuevo trae el DnsMasq.php original: sin el parche, Valet
    // volvería a tocar la red en la siguiente orden.
    steps.push({
      id: 'patch',
      label: 'Reapply safe DNS',
      fn: async () => { await patchValetDns(VALET_PKG, emit) }
    })
  } else {
    if (!d.pm) throw new Error('There is no compatible package manager.')
    const up = upgradeArgs(d.pm, item.packages)
    steps.push({
      id: 'update',
      label: `Upgrade ${item.label}`,
      fn: () => shElevated(emit, up.cmd, up.args, { pm: d.pm })
    })
  }

  steps.push({
    id: 'verify',
    label: 'Check the installed version',
    fn: async () => {
      const version = await readVersion(id)
      emit({ type: 'log', text: `${item.label}: ${version || 'no version'}\n` })
    }
  })

  await runSteps(steps, emit)
  cache = null
}
