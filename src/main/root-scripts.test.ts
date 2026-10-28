import { afterAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { BACKUP_SCRIPT, DNS_SCRIPT, SAFE_DEST_FN } from './root-scripts'

const run = promisify(execFile)

/** ¿Hay bash en esta máquina? Los ayudantes solo se ejecutan en Linux con bash. */
async function hasBash(): Promise<boolean> {
  try {
    await run('bash', ['-c', 'true'])
    return true
  } catch {
    return false
  }
}

async function check(script: string): Promise<{ code: number; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'vd-scripts-'))
  const file = join(dir, 'script.sh')
  await writeFile(file, script, { mode: 0o600 })
  try {
    await run('bash', ['-n', file])
    return { code: 0, stderr: '' }
  } catch (e) {
    const err = e as { code?: number; stderr?: string }
    return { code: err.code ?? 1, stderr: err.stderr ?? '' }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('scripts de root', () => {
  it('expanden la función compartida y no dejan marcadores sin resolver', () => {
    for (const script of [DNS_SCRIPT, BACKUP_SCRIPT]) {
      expect(script).not.toContain('${SAFE_DEST_FN}')
      expect(script).toContain('safe_dest() {')
      expect(script.startsWith('#!/bin/bash')).toBe(true)
    }
    expect(SAFE_DEST_FN).toContain('readlink -f')
  })

  it('el respaldo no sigue enlaces simbólicos al ceder la propiedad', async () => {
    const src = await readFile('src/main/root-scripts.ts', 'utf8')
    expect(src).toContain('chown -R -h')
    expect(src).not.toContain('chown -R "$OWNER" "$BACKUP_DIR"')
  })

  it('los dos scripts tienen sintaxis bash válida', async () => {
    if (!(await hasBash())) return
    for (const [name, script] of [['dns-helper.sh', DNS_SCRIPT], ['backup.sh', BACKUP_SCRIPT]] as const) {
      const result = await check(script)
      expect(result.stderr, `${name}: ${result.stderr}`).toBe('')
      expect(result.code).toBe(0)
    }
  })

  it('se niegan a correr sin root', async () => {
    if (!(await hasBash()) || typeof process.getuid !== 'function' || process.getuid() === 0) return
    const dir = await mkdtemp(join(tmpdir(), 'vd-scripts-'))
    const file = join(dir, 'backup.sh')
    await writeFile(file, BACKUP_SCRIPT, { mode: 0o700 })
    try {
      await run(file, ['/tmp/destino', 'nadie'])
      throw new Error('el script no debería ejecutarse sin root')
    } catch (e) {
      const err = e as { stderr?: string }
      expect(String(err.stderr ?? '')).toMatch(/root is required/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

/**
 * Ejecuta `safe_dest` con un home simulado y un `getent` falso: así se prueban
 * los rechazos reales del ayudante sin ser root ni tocar el home de verdad.
 */
describe('safe_dest', () => {
  const start = DNS_SCRIPT.indexOf('safe_dest() {')
  const body = DNS_SCRIPT.slice(start, DNS_SCRIPT.indexOf('\n}\n', start) + 3)
  const bases: string[] = []

  afterAll(async () => {
    for (const dir of bases) await rm(dir, { recursive: true, force: true })
  })

  async function scenario(dest: string | ((home: string) => Promise<string> | string)) {
    const base = await mkdtemp(join(tmpdir(), 'vd-dest-'))
    bases.push(base)
    const home = join(base, 'home')
    await mkdir(join(home, '.valet-dashboard'), { recursive: true, mode: 0o700 })
    const fakeBin = join(base, 'bin')
    await mkdir(fakeBin, { recursive: true, mode: 0o700 })
    await writeFile(join(fakeBin, 'getent'), `#!/bin/sh\necho "x:x:1000:1000::${home}:/bin/bash"\n`, { mode: 0o755 })
    const fn = join(base, 'fn.sh')
    await writeFile(
      fn,
      `#!/bin/bash\nfail() { printf '%s\\n' "$*" >&2; exit 1; }\n${body}\nsafe_dest "$1" "$2"\n`,
      { mode: 0o700 }
    )
    const target = typeof dest === 'function' ? await dest(home) : dest
    const user = (await run('id', ['-un'])).stdout.trim()
    try {
      await run(fn, [target, user], { env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` } })
      return { ok: true, stderr: '' }
    } catch (e) {
      const err = e as { stderr?: string }
      return { ok: false, stderr: String(err.stderr ?? '') }
    }
  }

  it('acepta un destino dentro de las copias del panel', async () => {
    const r = await scenario((home) => join(home, '.valet-dashboard', 'backups', '2026-01-01', 'dns'))
    expect(r.stderr).toBe('')
    expect(r.ok).toBe(true)
  })

  it('rechaza un destino fuera del panel', async () => {
    const r = await scenario('/etc')
    expect(r.ok).toBe(false)
    expect(r.stderr).toMatch(/outside the panel/)
  })

  it('rechaza un destino que sale por un enlace simbólico', async () => {
    const r = await scenario(async (home) => {
      await mkdir(join(home, 'fuera'), { recursive: true })
      await symlink(join(home, 'fuera'), join(home, '.valet-dashboard', 'backups'))
      return join(home, '.valet-dashboard', 'backups', '2026-01-01', 'dns')
    })
    expect(r.ok).toBe(false)
    expect(r.stderr).toMatch(/outside the panel/)
  })

  it('rechaza un destino que ya existe', async () => {
    const r = await scenario(async (home) => {
      const dest = join(home, '.valet-dashboard', 'backups', '2026-01-01', 'dns')
      await mkdir(dest, { recursive: true })
      return dest
    })
    expect(r.ok).toBe(false)
    expect(r.stderr).toMatch(/already exists/)
  })
})
