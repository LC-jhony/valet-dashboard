// Elevación de privilegios con alternativa: polkit (`pkexec`) cuando existe y,
// si no, `sudo -A` con nuestro propio diálogo de contraseña. La elección es una
// función pura (`planElevation`) para poder probarla sin tocar el sistema.
import { existsSync } from 'node:fs'
import { ASKPASS, ensureAskpass } from './askpass'
import { env, run, runInput, runWithEnv } from './exec'

export type Elevation = { cmd: 'pkexec' | '/usr/bin/sudo'; prefix: string[] }

/** Preferencia: pkexec; si no está, sudo con askpass. `null` si no hay forma. */
export function planElevation(hasPkexec: boolean, hasSudo: boolean, askpass: string | null): Elevation | null {
  if (hasPkexec) return { cmd: 'pkexec', prefix: [] }
  if (hasSudo && askpass) return { cmd: '/usr/bin/sudo', prefix: ['-A'] }
  return null
}

export const SUDO = '/usr/bin/sudo'

const hasCommand = async (cmd: string): Promise<boolean> => (await run('which', [cmd], true)).trim() !== ''

/** Detecta cómo se puede elevar en este sistema. */
export async function detectElevation(): Promise<'pkexec' | 'sudo' | null> {
  if (await hasCommand('pkexec')) return 'pkexec'
  const askpass = (await hasCommand('zenity')) || (await hasCommand('kdialog'))
  return planElevation(false, existsSync(SUDO), askpass ? ASKPASS : null) ? 'sudo' : null
}

let cached: Elevation | null | undefined

async function currentElevation(): Promise<Elevation | null> {
  if (cached) return cached
  const plan = planElevation(
    await hasCommand('pkexec'),
    existsSync(SUDO),
    (await hasCommand('zenity')) || (await hasCommand('kdialog')) ? ASKPASS : null
  )
  if (plan) cached = plan
  return plan
}

const sudoEnv = (): NodeJS.ProcessEnv => ({ ...env, SUDO_ASKPASS: ASKPASS })

/**
 * Comando y argumentos con los que elevar, para quien necesite lanzar el
 * proceso con su propia salida (el instalador lo hace con `spawn`).
 */
export async function elevationCommand(): Promise<{ cmd: string; args: string[] } | null> {
  const how = await currentElevation()
  if (!how) return null
  if (how.cmd === 'pkexec') return { cmd: 'pkexec', args: [] }
  await ensureAskpass()
  return { cmd: SUDO, args: how.prefix }
}

/**
 * Ejecuta un comando como root. Lanza un error explicable si no hay forma de
 * elevar: el mensaje lo muestra la guía de requisitos.
 */
export async function elevated(cmd: string, args: string[] = []): Promise<string> {
  const how = await currentElevation()
  if (!how) {
    throw new Error('No elevation method: install polkit (pkexec) or sudo with zenity')
  }
  if (how.cmd === 'pkexec') return run('pkexec', [cmd, ...args])
  await ensureAskpass()
  return runWithEnv(SUDO, [...how.prefix, cmd, ...args], sudoEnv())
}

/** Igual que {@link elevated}, con datos por la entrada estándar (secretos). */
export async function elevatedInput(cmd: string, args: string[], input: string): Promise<string> {
  const how = await currentElevation()
  if (!how) {
    throw new Error('No elevation method: install polkit (pkexec) or sudo with zenity')
  }
  if (how.cmd === 'pkexec') return runInput('pkexec', [cmd, ...args], input)
  await ensureAskpass()
  return runInput(SUDO, [...how.prefix, cmd, ...args], input, false, sudoEnv())
}

/** Compatibilidad con el nombre anterior: eleva y devuelve la salida. */
export const sudo = (cmd: string, args: string[] = []): Promise<string> => elevated(cmd, args)
