import { userInfo } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { env, runWithEnv, COMPOSER_BIN } from './exec'
import { ASKPASS, BIN, ensureSudoHelpers } from './askpass'
import { elevated } from './elevate'

export { ASKPASS, BIN } from './askpass'

export const USER_NAME = userInfo().username

/**
 * Directorio de ayudantes que se ejecutan como root. Debe ser propiedad de root:
 * si el script viviera en el home del usuario, cualquiera podría cambiarlo entre
 * el diálogo de polkit y la ejecución y obtener root.
 */
export const ROOT_HELPER_DIR = '/usr/local/libexec/valet-dashboard'

/** Ayudantes para que Valet use sudo sin terminal y sin ejecutar Valet como root. */
export async function prepareHelpers() {
  await ensureSudoHelpers()
}

export const privilegedEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...env,
  PATH: `${BIN}:${COMPOSER_BIN}:${env.PATH ?? ''}`,
  SUDO_ASKPASS: ASKPASS,
  ...extra
})

/**
 * Entorno para herramientas que no deben poder elevar privilegios por su cuenta
 * (Composer y los scripts que ejecuta). Deja fuera el ayudante `sudo` y el
 * `SUDO_ASKPASS` que usa Valet para sus propias llamadas.
 */
export const unprivilegedEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ ...env, ...extra })

/**
 * Instala un script como root en {@link ROOT_HELPER_DIR}. Primero se deja una
 * copia temporal en el home y `install(1)` la copia con dueño root; a partir de
 * ahí el usuario ya no puede modificarla.
 *
 * @returns la ruta absoluta del script propiedad de root.
 */
export async function installRootHelper(name: string, content: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error('Invalid helper name: ' + name)
  const target = join(ROOT_HELPER_DIR, name)
  const existing = await readFile(target, 'utf8').catch(() => null)
  if (existing === content) return target

  await mkdir(BIN, { recursive: true, mode: 0o700 })
  const staged = join(BIN, `.${name}.nuevo`)
  await writeFile(staged, content, { mode: 0o600 })
  try {
    await elevated('install', ['-D', '-m', '0755', '-o', 'root', '-g', 'root', staged, target])
  } finally {
    await rm(staged, { force: true }).catch(() => '')
  }
  return target
}

/** Ejecuta Valet como el usuario actual. Valet decide internamente qué comandos elevar. */
export const runValet = (args: string[], lenient = false, cwd?: string) =>
  runWithEnv('valet', args, privilegedEnv(), lenient, cwd)

/** Ejecuta un comando root con la contraseña pedida por zenity/kdialog. */
export const runSudo = (cmd: string, args: string[], extra: NodeJS.ProcessEnv = {}) =>
  runWithEnv('/usr/bin/sudo', ['-A', cmd, ...args], privilegedEnv(extra))
