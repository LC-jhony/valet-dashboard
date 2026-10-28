import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashPassword } from './htpasswd'

/** Crea un `htpasswd` falso que registra sus argumentos y lee la contraseña. */
async function fakeHtpasswd(body: string): Promise<{ bin: string; base: string; args: string }> {
  const base = await mkdtemp(join(tmpdir(), 'vd-htpasswd-'))
  const argsFile = join(base, 'args.txt')
  const bin = join(base, 'htpasswd')
  await writeFile(
    bin,
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${argsFile}\n${body}\n`,
    { mode: 0o755 }
  )
  return { bin, base, args: argsFile }
}

describe('hashPassword', () => {
  it('manda la contraseña por stdin y nunca como argumento', async () => {
    const { bin, base, args } = await fakeHtpasswd(
      'read -r pass\nprintf \'%s:%s\\n\' "$2" "hash-de-$pass"\n'
    )
    try {
      // Se invoca como `htpasswd -niB usuario`: el usuario es el segundo argumento.
      const line = await hashPassword('ana', 'secreto-123', { binary: bin })
      expect(line).toBe('ana:hash-de-secreto-123')
      const argv = await readFile(args, 'utf8')
      expect(argv).not.toContain('secreto-123')
      expect(argv.split('\n').filter(Boolean)).toEqual(['-niB', 'ana'])
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('falla en duro si htpasswd está instalado y no devuelve un hash', async () => {
    const { bin, base } = await fakeHtpasswd('echo "error: algo se rompió" >&2; exit 1')
    try {
      await expect(hashPassword('ana', 'secreto-123', { binary: bin }))
        .rejects.toThrow(/Could not generate the password hash/)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('sin htpasswd guarda en claro (Mailpit lo acepta y el archivo queda 0600)', async () => {
    await expect(hashPassword('ana', 'secreto-123', { binary: null })).resolves.toBe('ana:secreto-123')
  })
})
