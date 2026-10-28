import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()
const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

export const APP_DIR = join(HOME, '.valet-dashboard')
export const COMPOSER_HOME = join(HOME, '.config', 'valet-dashboard', 'composer')
export const COMPOSER_BIN = join(COMPOSER_HOME, 'vendor', 'bin')

export const env: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: [COMPOSER_BIN, process.env.PATH, SYSTEM_PATH].filter(Boolean).join(':')
}

/** Tiempo máximo por comando. El gestor de paquetes puede tardar. */
export const TIMEOUT_MS = 900_000

/** Siempre execFile con array de argumentos: nunca pasa por un shell. */
export function runWithEnv(cmd: string, args: string[] = [], customEnv: NodeJS.ProcessEnv = env, lenient = false, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: customEnv, timeout: TIMEOUT_MS, cwd }, (err, stdout, stderr) => {
      if (err && !lenient) reject(new Error(stderr.trim() || err.message))
      else resolve(stdout)
    })
  })
}

export function run(cmd: string, args: string[] = [], lenient = false, cwd?: string): Promise<string> {
  return runWithEnv(cmd, args, env, lenient, cwd)
}

/**
 * Como {@link run}, pero devuelve las dos salidas. `nginx -v` y
 * `dnsmasq --version` escriben la versión solo en stderr.
 */
export function runCapture(
  cmd: string, args: string[] = [], lenient = false
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env, timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err && !lenient) reject(new Error(stderr.trim() || err.message))
      else resolve({ stdout, stderr })
    })
  })
}

/**
 * Ejecuta un comando con datos por la entrada estándar. Necesario para secretos:
 * los argumentos de un proceso son visibles en `ps` para cualquier usuario.
 */
export function runInput(
  cmd: string, args: string[], input: string, lenient = false, customEnv: NodeJS.ProcessEnv = env
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { env: customEnv, timeout: 60_000 }, (err, stdout, stderr) => {
      if (err && !lenient) reject(new Error(stderr.trim() || err.message))
      else resolve(stdout)
    })
    child.stdin?.on('error', () => { /* el comando puede cerrar la entrada antes */ })
    child.stdin?.end(input)
  })
}
