import { resolve, sep } from 'node:path'

export interface AppUrlOptions {
  /** Origen del servidor de desarrollo (`ELECTRON_RENDERER_URL`), vacío en producción. */
  devUrl: string
  /** Carpeta del renderer compilado (`out/renderer`). */
  rendererDir: string
}

const insideDir = (pathname: string, dir: string): boolean => {
  const root = resolve(dir)
  const target = resolve(pathname)
  return target === root || target.startsWith(`${root}${sep}`)
}

/**
 * ¿Es una URL de la propia aplicación? Solo estas pueden cargarse en la ventana
 * principal: cualquier otra se abre fuera, porque el preload (y con él todo el
 * IPC) sobrevive a la navegación.
 */
export function isAppUrl(url: string, opts: AppUrlOptions): boolean {
  try {
    const parsed = new URL(url)
    if (opts.devUrl) return parsed.origin === new URL(opts.devUrl).origin
    if (parsed.protocol !== 'file:') return false
    return insideDir(decodeURIComponent(parsed.pathname), opts.rendererDir)
  } catch {
    return false
  }
}
