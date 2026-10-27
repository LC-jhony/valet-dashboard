import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

const HOME = homedir()

export const expandHome = (p: string) =>
  p === '~' ? HOME : p.startsWith('~/') ? join(HOME, p.slice(2)) : p

/**
 * Error de ruta fuera de la raíz permitida. Se distingue del resto para que la
 * interfaz pueda mostrar el motivo sin exponer detalles del sistema.
 */
export class UnsafePathError extends Error {
  constructor(label: string, root: string) {
    super(`${label} debe estar dentro de ${root}`)
    this.name = 'UnsafePathError'
  }
}

/**
 * Resuelve symlinks aunque el destino final no exista todavía: desciende hasta
 * el primer ancestro existente y reconstruye el resto. Así un enlace simbólico
 * intermedio no puede sacar la ruta de su raíz.
 */
async function realish(path: string): Promise<string> {
  const abs = resolve(expandHome(path))
  try {
    return await realpath(abs)
  } catch {
    const parent = dirname(abs)
    if (parent === abs) return abs
    return join(await realish(parent), basename(abs))
  }
}

/** Comprobación léxica, sin tocar el disco. Sirve para validar antes de escribir. */
export function isWithinRoot(root: string, candidate: string): boolean {
  if (!candidate) return false
  const r = resolve(expandHome(root))
  const c = resolve(expandHome(candidate))
  if (!isAbsolute(c) || c === r) return false
  return c.startsWith(`${r}${sep}`)
}

/**
 * Devuelve la ruta real del candidato y exige que quede estrictamente dentro de
 * la raíz: resuelve symlinks, rechaza la propia raíz y rechaza `..`.
 *
 * @throws {UnsafePathError} cuando el destino se sale de la raíz permitida.
 */
export async function resolveWithinRoot(root: string, candidate: string, label: string): Promise<string> {
  if (!candidate || !candidate.trim()) throw new UnsafePathError(label, root)
  const rootReal = await realish(root)
  const targetReal = await realish(candidate)
  if (targetReal === rootReal || !targetReal.startsWith(`${rootReal}${sep}`)) {
    throw new UnsafePathError(label, root)
  }
  return targetReal
}

/** ¿Es un ejecutable de sistema en un directorio de confianza? (comprobación léxica) */
export function isTrustedBinaryPath(roots: string[], candidate: string): boolean {
  return roots.some((root) => isWithinRoot(root, candidate) || resolve(expandHome(candidate)) === resolve(expandHome(root)))
}
