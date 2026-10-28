// Localiza el instalador de Laravel y ejecuta `laravel new` sin terminal.
// El asistente ya ha respondido todas las preguntas, así que el proceso va
// siempre en modo no interactivo con las opciones explícitas. Sin PTY y sin
// parsear prompts: lo que el usuario ve es la misma salida que vería en una
// terminal, pero las decisiones viajan como argumentos y variables de entorno.

import { spawn, type ChildProcess } from 'node:child_process'
import { constants as fsConstants, readdirSync } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  NODE_MANAGERS, buildLaravelArgs, databaseEnv, formatCommand, parseInstallerFlags,
  pdoDriversToDatabases,
  type DatabaseConnection, type LaravelAnswers, type LaravelCapabilities, type NodeManager
} from '../shared/laravel'
import type { CreateProjectEvent } from '../shared/types'
import { COMPOSER_BIN, COMPOSER_HOME, TIMEOUT_MS, runWithEnv } from './exec'
import { unprivilegedEnv } from './helpers'

type Emit = (e: CreateProjectEvent) => void

export interface InstalledLaravel {
  /** Ruta absoluta del binario `laravel`. */
  bin: string
  version: string | null
  /** Opciones que anuncia `laravel new --help`; `null` si no se pudieron leer. */
  flags: string[] | null
}

/**
 * Variables con las que el instalador se cree dentro de un agente y cambia a
 * una salida JSON sin preguntas. El panel es quien pregunta: hay que borrarlas
 * del entorno del proceso.
 */
const AGENT_ENV_VARS = [
  'AI_AGENT', 'CURSOR_AGENT', 'GEMINI_CLI',
  'CODEX_SANDBOX', 'CODEX_CI', 'CODEX_THREAD_ID',
  'AUGMENT_AGENT', 'OPENCODE_CLIENT', 'OPENCODE',
  'AMP_CURRENT_THREAD_ID', 'CLAUDECODE', 'CLAUDE_CODE', 'CLAUDE_CODE_IS_COWORK',
  'REPL_ID', 'COPILOT_MODEL', 'COPILOT_ALLOW_ALL', 'COPILOT_GITHUB_TOKEN', 'COPILOT_CLI',
  'ANTIGRAVITY_AGENT', 'PI_CODING_AGENT', 'KIRO_AGENT_PATH'
]

/**
 * Directorios donde suele vivir Node cuando la aplicación se abre desde el
 * escritorio y el PATH de la sesión gráfica no incluye nvm, bun o volta.
 */
let toolDirs: string[] | null = null
function extraToolDirs(): string[] {
  if (toolDirs) return toolDirs
  const dirs = [
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.bun', 'bin'),
    join(homedir(), '.volta', 'bin'),
    join(homedir(), '.npm-global', 'bin')
  ]
  try {
    const root = join(homedir(), '.nvm', 'versions', 'node')
    for (const version of readdirSync(root).sort().reverse()) dirs.push(join(root, version, 'bin'))
  } catch { /* nvm no está instalado */ }
  return (toolDirs = dirs)
}

function searchPath(): string {
  const base = unprivilegedEnv().PATH ?? ''
  return [...extraToolDirs(), base].filter(Boolean).join(delimiter)
}

/** Entorno sin ayudantes de elevación, sin marcadores de agente y sin color. */
function baseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const out = unprivilegedEnv({
    PATH: searchPath(),
    COMPOSER_NO_INTERACTION: '1',
    TERM: 'dumb',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    ...extra
  })
  for (const key of AGENT_ENV_VARS) delete out[key]
  return out
}

async function executable(file: string): Promise<boolean> {
  try {
    await access(file, fsConstants.X_OK)
    return (await stat(file)).isFile()
  } catch { return false }
}

/** Busca un binario en el mismo PATH con el que se ejecutarán los comandos. */
export async function which(bin: string): Promise<string | null> {
  const path = baseEnv().PATH ?? ''
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const file = join(dir, bin)
    if (await executable(file)) return file
  }
  return null
}

/** Candidatos habituales, incluidos los que el PATH de la sesión gráfica no trae. */
function candidates(): string[] {
  const seen = new Set<string>()
  const add = (p: string) => { if (p) seen.add(p) }
  add(join(COMPOSER_BIN, 'laravel'))
  add(join(homedir(), '.config', 'composer', 'vendor', 'bin', 'laravel'))
  add(join(homedir(), '.composer', 'vendor', 'bin', 'laravel'))
  add(join(homedir(), '.local', 'composer', 'vendor', 'bin', 'laravel'))
  return [...seen]
}

async function readVersion(bin: string): Promise<string | null> {
  try {
    const out = await runWithEnv(bin, ['--version'], baseEnv(), true)
    return out.match(/Laravel Installer\s+([0-9][\w.-]*)/i)?.[1] ?? null
  } catch { return null }
}

async function readFlags(bin: string): Promise<string[] | null> {
  try {
    return parseInstallerFlags(await runWithEnv(bin, ['new', '--help'], baseEnv(), true))
  } catch { return null }
}

async function detectUncached(): Promise<InstalledLaravel | null> {
  const list = [...candidates()]
  const fromPath = await which('laravel')
  if (fromPath) list.push(fromPath)
  for (const bin of list) {
    if (!(await executable(bin))) continue
    const version = await readVersion(bin)
    // Un `laravel` que no es el instalador (por ejemplo, un binario de un
    // proyecto) no responde con esta versión; se ignora.
    if (!version) continue
    return { bin, version, flags: await readFlags(bin) }
  }
  return null
}

/** Instalador disponible en el sistema, sin instalar nada. */
export function detectLaravel(): Promise<InstalledLaravel | null> {
  return detectUncached()
}

/** Extensiones cargadas en el PHP que usará el instalador. */
export async function phpExtensions(): Promise<string[]> {
  try {
    const out = await runWithEnv(
      'php', ['-r', 'echo implode("\\n", get_loaded_extensions());'], baseEnv(), true
    )
    return out.split('\n').map((line) => line.trim()).filter(Boolean)
  } catch { return [] }
}

/** Gestores de Node que existen realmente en el equipo. */
export async function nodeManagers(): Promise<NodeManager[]> {
  const found = await Promise.all(NODE_MANAGERS.map(async (m) => ((await which(m)) ? m : null)))
  return found.filter((m): m is NodeManager => m !== null)
}

/** Lo que el sistema permite elegir en el asistente. */
export async function laravelCapabilities(installer: InstalledLaravel | null): Promise<LaravelCapabilities> {
  const [extensions, managers] = await Promise.all([phpExtensions(), nodeManagers()])
  return {
    flags: installer?.flags ?? null,
    databases: pdoDriversToDatabases(extensions),
    nodeManagers: managers
  }
}

/** Instala el instalador en el Composer aislado del panel si no hay ninguno. */
export async function ensureLaravel(emit: Emit): Promise<InstalledLaravel> {
  const found = await detectLaravel()
  if (found) return found

  const composer = await which('composer')
  if (!composer) {
    throw new Error('No se encontró el instalador de Laravel ni Composer. Instala Composer desde la pestaña Instalación.')
  }

  emit({ type: 'stage', label: 'Instalando el instalador de Laravel…' })
  const args = ['global', 'require', 'laravel/installer', '--no-interaction', '--no-progress']
  emit({ type: 'log', text: `$ composer ${formatCommand(args)}\n` })
  await new Promise<void>((resolve, reject) => {
    const child = spawn(composer, args, {
      env: baseEnv({ COMPOSER_HOME }),
      // Grupo propio, igual que `laravel new`: cancelar debe alcanzar a sus hijos.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    active = child
    cancelled = false
    let stderr = ''
    let timedOut = false
    const limit = setTimeout(() => { timedOut = true; stopGroup(child) }, TIMEOUT_MS)
    limit.unref()
    const finish = () => {
      clearTimeout(limit)
      if (killTimer) { clearTimeout(killTimer); killTimer = null }
      if (active === child) active = null
    }
    const out = (b: Buffer) => emit({ type: 'log', text: b.toString() })
    child.stdout?.on('data', out)
    child.stderr?.on('data', (b: Buffer) => { stderr += b.toString(); out(b) })
    child.on('error', (e) => {
      finish()
      reject(new Error(`No se pudo ejecutar Composer: ${e.message}`))
    })
    child.on('close', (code) => {
      finish()
      if (cancelled) return reject(new Error('Creación cancelada.'))
      if (timedOut) return reject(new Error('Composer superó el tiempo máximo y se detuvo.'))
      if (code === 0) return resolve()
      const detail = stderr.trim().split('\n').filter(Boolean).slice(-3).join('\n')
      reject(new Error(`No se pudo instalar el instalador de Laravel (código ${code}).${detail ? `\n${detail}` : ''}`))
    })
  })

  const after = await detectLaravel()
  if (!after) throw new Error('El instalador de Laravel se instaló pero no se pudo ejecutar. Revisa la salida de Composer.')
  return after
}

let active: ChildProcess | null = null
let cancelled = false
let killTimer: NodeJS.Timeout | null = null

function stopGroup(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) return
  try { process.kill(-pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch { /* ya terminó */ } }
  killTimer = setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL') } catch { /* ya terminó */ }
  }, 5_000)
  killTimer.unref()
}

/**
 * Detiene el `laravel new` en curso. El instalador lanza Composer, PHP y el
 * gestor de Node: hay que matar el grupo completo, no solo el proceso padre.
 */
export function cancelLaravelNew(): void {
  if (!active || cancelled) return
  cancelled = true
  stopGroup(active)
}

/**
 * Ejecuta `laravel new` con las respuestas del asistente. Las credenciales de
 * base de datos viajan por el entorno (nunca en los argumentos ni en el log)
 * porque `artisan migrate` las lee antes que el `.env` del proyecto.
 */
export function runLaravelNew(
  installer: InstalledLaravel,
  parentDir: string,
  answers: LaravelAnswers,
  connection: DatabaseConnection | null,
  emit: Emit
): Promise<void> {
  const args = ['new', ...buildLaravelArgs(answers, installer.flags)]
  emit({ type: 'log', text: `$ ${formatCommand(['laravel', ...args])}\n` })
  const extra = answers.database !== 'sqlite' && connection ? databaseEnv(answers.database, connection) : {}

  return new Promise((resolve, reject) => {
    const child = spawn(installer.bin, args, {
      cwd: parentDir,
      env: baseEnv(extra),
      // Grupo propio: así la cancelación alcanza a Composer, PHP y Node.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    active = child
    cancelled = false
    let stderr = ''
    let timedOut = false
    const limit = setTimeout(() => { timedOut = true; stopGroup(child) }, TIMEOUT_MS)
    limit.unref()

    const finish = () => {
      clearTimeout(limit)
      if (killTimer) { clearTimeout(killTimer); killTimer = null }
      if (active === child) active = null
    }
    const out = (b: Buffer) => emit({ type: 'log', text: b.toString() })
    child.stdout?.on('data', out)
    child.stderr?.on('data', (b: Buffer) => { stderr += b.toString(); out(b) })
    child.on('error', (e) => {
      finish()
      reject(new Error(`No se pudo ejecutar el instalador de Laravel: ${e.message}`))
    })
    child.on('close', (code) => {
      finish()
      if (cancelled) return reject(new Error('Creación cancelada. La carpeta del proyecto puede haber quedado incompleta.'))
      if (timedOut) return reject(new Error('El instalador de Laravel superó el tiempo máximo y se detuvo.'))
      if (code === 0) return resolve()
      const detail = stderr.trim().split('\n').filter(Boolean).slice(-3).join('\n')
      reject(new Error(`El instalador de Laravel terminó con código ${code}.${detail ? `\n${detail}` : ' Revisa el registro.'}`))
    })
  })
}
