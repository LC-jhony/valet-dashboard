import { execFile } from 'node:child_process'
import { homedir } from 'node:os'

export const env = {
  ...process.env,
  PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${process.env.PATH}:${homedir()}/.config/composer/vendor/bin:${homedir()}/.composer/vendor/bin`
}

/** Siempre execFile con array de argumentos: nunca pasa por un shell. */
export function run(cmd: string, args: string[] = [], lenient = false): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env, timeout: 120_000 }, (err, stdout, stderr) => {
      if (err && !lenient) reject(new Error(stderr.trim() || err.message))
      else resolve(stdout)
    })
  })
}

/** Operaciones privilegiadas: polkit muestra el diálogo de contraseña. */
export const sudo = (cmd: string, args: string[]) => run('pkexec', [cmd, ...args])
