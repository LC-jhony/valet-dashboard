import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isTrustedBinaryPath, isWithinRoot, resolveWithinRoot, UnsafePathError } from './safe-path'

async function sandbox() {
  const base = await mkdtemp(join(tmpdir(), 'vd-safe-'))
  const root = join(base, 'root')
  const outside = join(base, 'outside')
  await mkdir(root, { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(outside, 'secreto.txt'), 'no deberías leer esto')
  return { base, root, outside }
}

describe('resolveWithinRoot', () => {
  it('acepta un archivo nuevo dentro de la raíz', async () => {
    const { root } = await sandbox()
    await expect(resolveWithinRoot(root, join(root, 'nuevo.yml'), 'YAML')).resolves.toBe(join(root, 'nuevo.yml'))
  })

  it('acepta subdirectorios anidados', async () => {
    const { root } = await sandbox()
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await expect(resolveWithinRoot(root, join(root, 'a', 'b', 'x.db'), 'Base')).resolves.toContain('x.db')
  })

  it('rechaza una ruta absoluta fuera de la raíz', async () => {
    const { root, outside } = await sandbox()
    await expect(resolveWithinRoot(root, join(outside, 'secreto.txt'), 'Registro')).rejects.toBeInstanceOf(UnsafePathError)
  })

  it('rechaza el escape con ..', async () => {
    const { root, outside } = await sandbox()
    await expect(resolveWithinRoot(root, join(root, '..', 'outside', 'x'), 'Base')).rejects.toBeInstanceOf(UnsafePathError)
  })

  it('rechaza la propia raíz', async () => {
    const { root } = await sandbox()
    await expect(resolveWithinRoot(root, root, 'Base')).rejects.toBeInstanceOf(UnsafePathError)
  })

  it('rechaza un symlink que apunta fuera', async () => {
    const { root, outside } = await sandbox()
    await symlink(join(outside, 'secreto.txt'), join(root, 'enlace'))
    await expect(resolveWithinRoot(root, join(root, 'enlace'), 'Base')).rejects.toBeInstanceOf(UnsafePathError)
  })

  it('rechaza un directorio intermedio que es symlink hacia fuera', async () => {
    const { root, outside } = await sandbox()
    await symlink(outside, join(root, 'dir'))
    await expect(resolveWithinRoot(root, join(root, 'dir', 'nuevo.db'), 'Base')).rejects.toBeInstanceOf(UnsafePathError)
  })

  it('acepta un symlink que no sale de la raíz', async () => {
    const { root } = await sandbox()
    await writeFile(join(root, 'real.db'), 'x')
    await symlink(join(root, 'real.db'), join(root, 'alias.db'))
    await expect(resolveWithinRoot(root, join(root, 'alias.db'), 'Base')).resolves.toBe(join(root, 'real.db'))
  })

  it('rechaza cadena vacía', async () => {
    const { root } = await sandbox()
    await expect(resolveWithinRoot(root, '   ', 'Base')).rejects.toBeInstanceOf(UnsafePathError)
  })
})

describe('isWithinRoot', () => {
  it('no confunde un prefijo de nombre con un hijo', async () => {
    const { base } = await sandbox()
    expect(isWithinRoot(join(base, 'root'), join(base, 'root-otro', 'x'))).toBe(false)
    expect(isWithinRoot(join(base, 'root'), join(base, 'root', 'x'))).toBe(true)
  })
})

describe('isTrustedBinaryPath', () => {
  it('acepta un binario en una raíz permitida y rechaza /tmp', () => {
    expect(isTrustedBinaryPath(['/usr/local/bin', '/usr/bin'], '/usr/bin/mailpit')).toBe(true)
    expect(isTrustedBinaryPath(['/usr/bin'], '/usr/bin/mailpit')).toBe(true)
    expect(isTrustedBinaryPath(['/usr/bin'], '/tmp/mailpit')).toBe(false)
    expect(isTrustedBinaryPath(['/usr/bin'], '/usr/bin/../tmp/mailpit')).toBe(false)
  })
})
