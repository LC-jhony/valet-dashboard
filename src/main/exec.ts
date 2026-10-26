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

/** Siempre execFile con array de argumentos: nunca pasa por un shell. */
export function runWithEnv(cmd: string, args: string[] = [], customEnv: NodeJS.ProcessEnv = env, lenient = false, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: customEnv, timeout: 600_000, cwd }, (err, stdout, stderr) => {
      if (err && !lenient) reject(new Error(stderr.trim() || err.message))
      else resolve(stdout)
    })
  })
}

export function run(cmd: string, args: string[] = [], lenient = false, cwd?: string): Promise<string> {
  return runWithEnv(cmd, args, env, lenient, cwd)
}

/** Operaciones privilegiadas: polkit muestra el diálogo de contraseña. */
export const sudo = (cmd: string, args: string[]) => run('pkexec', [cmd, ...args])
