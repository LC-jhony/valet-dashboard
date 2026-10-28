// Ayudantes que viven en el home del usuario: el diálogo de contraseña y el
// envoltorio de `sudo` que usa Valet. Módulo hoja: no importa otros ayudantes,
// así lo pueden usar tanto `helpers.ts` como `elevate.ts` sin ciclos.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'

export const BIN = join(homedir(), '.valet-dashboard', 'bin')
export const ASKPASS = join(BIN, 'askpass')
export const SUDO_WRAPPER = join(BIN, 'sudo')

const ASKPASS_SCRIPT = `#!/bin/sh
if command -v zenity >/dev/null 2>&1; then exec zenity --password --title="Valet Dashboard: contraseña de administrador"; fi
if command -v kdialog >/dev/null 2>&1; then exec kdialog --password "Contraseña de administrador"; fi
exit 1
`

const SUDO_SCRIPT = `#!/bin/sh
# Envuelve solo las llamadas de Valet que usan "sudo env ...".
# No altera opciones como "sudo -u", que no usa el instalador.
case "\${1:-}" in
  -*) exec /usr/bin/sudo -A "$@" ;;
  *) safe="\${VALET_DASHBOARD_SAFE_DNS:-0}"; exec /usr/bin/sudo -A env "VALET_DASHBOARD_SAFE_DNS=\$safe" "$@" ;;
esac
`

async function writeIfChanged(file: string, content: string, mode: number): Promise<void> {
  await mkdir(BIN, { recursive: true, mode: 0o700 })
  const current = await readFile(file, 'utf8').catch(() => null)
  if (current !== content) await writeFile(file, content, { mode })
  await chmod(file, mode)
}

/** Deja el diálogo de contraseña listo y devuelve su ruta. */
export async function ensureAskpass(): Promise<string> {
  await writeIfChanged(ASKPASS, ASKPASS_SCRIPT, 0o755)
  return ASKPASS
}

/** Deja el envoltorio de `sudo` que usa Valet y el diálogo de contraseña. */
export async function ensureSudoHelpers(): Promise<void> {
  await writeIfChanged(ASKPASS, ASKPASS_SCRIPT, 0o755)
  await writeIfChanged(SUDO_WRAPPER, SUDO_SCRIPT, 0o755)
}
