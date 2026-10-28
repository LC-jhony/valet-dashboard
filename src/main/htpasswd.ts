import { existsSync } from 'node:fs'
import { runInput } from './exec'

/** Rutas habituales de `htpasswd`; se evita resolverlo por `PATH`. */
const HTPASSWD_PATHS = [
  '/usr/bin/htpasswd',
  '/usr/local/bin/htpasswd',
  '/bin/htpasswd',
  '/usr/sbin/htpasswd'
]

export const htpasswdBinary = (): string | null => HTPASSWD_PATHS.find((p) => existsSync(p)) ?? null

export interface HashOptions {
  /** Binario a usar. `null` fuerza el modo sin `htpasswd`. Solo para pruebas. */
  binary?: string | null
}

/**
 * Devuelve la línea `usuario:hash` para el archivo de autenticación de Mailpit.
 *
 * La contraseña viaja por la entrada estándar: los argumentos de un proceso son
 * visibles para cualquier usuario con `ps`.
 *
 * Sin `htpasswd` instalado se guarda en claro, que Mailpit acepta y que el
 * archivo protege con permisos 0600. Si `htpasswd` está instalado pero no
 * consigue hashear, se aborta: nunca se degrada a texto plano en silencio.
 *
 * @throws {Error} cuando `htpasswd` existe pero no devuelve un hash válido.
 */
export async function hashPassword(user: string, password: string, opts: HashOptions = {}): Promise<string> {
  const bin = opts.binary === undefined ? htpasswdBinary() : opts.binary
  if (!bin) return `${user}:${password}`
  const out = await runInput(bin, ['-niB', user], `${password}\n`, true)
  const line = out.split('\n').map((l) => l.trim()).find((l) => l.startsWith(`${user}:`))
  if (!line) {
    throw new Error(
      `Could not generate the password hash with ${bin}. Reinstall apache2-utils (the package that provides htpasswd) and try again.`
    )
  }
  return line
}
