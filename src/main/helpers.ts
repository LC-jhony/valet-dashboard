import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { mkdir, writeFile, chmod } from 'node:fs/promises'
import { env, runWithEnv, COMPOSER_BIN } from './exec'

export const USER_NAME = userInfo().username
export const BIN = join(homedir(), '.valet-dashboard', 'bin')
export const ASKPASS = join(BIN, 'askpass')

/** Ayudantes para que Valet use sudo sin terminal y sin ejecutar Valet como root. */
export async function prepareHelpers() {
  await mkdir(BIN, { recursive: true })
  await writeFile(join(BIN, 'askpass'), `#!/bin/sh
if command -v zenity >/dev/null 2>&1; then exec zenity --password --title="Valet Dashboard: contraseña de administrador"; fi
if command -v kdialog >/dev/null 2>&1; then exec kdialog --password "Contraseña de administrador"; fi
exit 1
`)
  await writeFile(join(BIN, 'sudo'), `#!/bin/sh
# Envuelve solo las llamadas de Valet que usan "sudo env ...".
# No altera opciones como "sudo -u", que no usa el instalador.
case "\${1:-}" in
  -*) exec /usr/bin/sudo -A "$@" ;;
  *) safe="\${VALET_DASHBOARD_SAFE_DNS:-0}"; exec /usr/bin/sudo -A env "VALET_DASHBOARD_SAFE_DNS=\$safe" "$@" ;;
esac
`)
  await chmod(join(BIN, 'askpass'), 0o755)
  await chmod(join(BIN, 'sudo'), 0o755)
}

export const privilegedEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...env,
  PATH: `${BIN}:${COMPOSER_BIN}:${env.PATH ?? ''}`,
  SUDO_ASKPASS: ASKPASS,
  ...extra
})

/** Ejecuta Valet como el usuario actual. Valet decide internamente qué comandos elevar. */
export const runValet = (args: string[], lenient = false, cwd?: string) =>
  runWithEnv('valet', args, privilegedEnv(), lenient, cwd)

/** Ejecuta un comando root con la contraseña pedida por zenity/kdialog. */
export const runSudo = (cmd: string, args: string[], extra: NodeJS.ProcessEnv = {}) =>
  runWithEnv('/usr/bin/sudo', ['-A', cmd, ...args], privilegedEnv(extra))
