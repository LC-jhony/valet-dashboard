import { describe, expect, it } from 'vitest'
import {
  evaluate, fixCommands, hasBlocking, installArgs, missingQuery, parseMissing, requiredPackages,
  updateArgs, type PrereqProbe
} from './prereqs'

const OK_TOOLS = {
  php: true, composer: true, nginx: true, certutil: true, xsel: true, jq: true,
  git: true, unzip: true, pkexec: true, sudo: true, zenity: true, kdialog: false
}

const probe = (over: Partial<PrereqProbe> = {}): PrereqProbe => ({
  pm: 'apt',
  systemd: true,
  graphical: true,
  diskFreeMb: 50_000,
  network: true,
  tools: { ...OK_TOOLS },
  ...over
})

const byId = (list: ReturnType<typeof evaluate>, id: string) => list.find((p) => p.id === id)!

describe('requisitos previos', () => {
  it('dan todo por resuelto en un sistema completo', () => {
    const list = evaluate(probe())
    expect(list.every((p) => p.ok)).toBe(true)
    expect(hasBlocking(list)).toBe(false)
    expect(list.every((p) => p.commands.length === 0 || p.id === 'disk')).toBe(true)
  })

  it('acepta sudo con zenity cuando no hay polkit', () => {
    const list = evaluate(probe({ tools: { ...OK_TOOLS, pkexec: false } }))
    expect(byId(list, 'elevation').ok).toBe(true)
    expect(byId(list, 'elevation').detail).toContain('sudo will be used with')
    expect(hasBlocking(list)).toBe(false)
  })

  it('bloquea si hay sudo pero ningún diálogo de contraseña', () => {
    const list = evaluate(probe({ tools: { ...OK_TOOLS, pkexec: false, zenity: false } }))
    expect(byId(list, 'elevation').ok).toBe(false)
    expect(byId(list, 'elevation').blocking).toBe(true)
    expect(byId(list, 'askpass').blocking).toBe(true)
    expect(byId(list, 'elevation').commands).toContain('sudo apt-get install -y zenity')
    expect(hasBlocking(list)).toBe(true)
  })

  it('bloquea sin pkexec ni sudo y ofrece las dos salidas', () => {
    const list = evaluate(probe({ tools: { ...OK_TOOLS, pkexec: false, sudo: false } }))
    const commands = byId(list, 'elevation').commands
    expect(commands).toContain('sudo apt-get install -y policykit-1')
    expect(byId(list, 'sudo').blocking).toBe(true)
  })

  it('bloquea sin systemd', () => {
    const list = evaluate(probe({ systemd: false }))
    expect(byId(list, 'systemd').blocking).toBe(true)
    expect(byId(list, 'systemd').commands).toEqual([])
  })

  it('no bloquea por paquetes cuando hay gestor, y sí cuando no lo hay', () => {
    const missing = { ...OK_TOOLS, php: false, composer: false }
    const conPm = evaluate(probe({ tools: missing }))
    expect(byId(conPm, 'packages').ok).toBe(false)
    expect(byId(conPm, 'packages').blocking).toBe(false)
    expect(hasBlocking(conPm)).toBe(false)

    const sinPm = evaluate(probe({ pm: null, tools: missing }))
    expect(byId(sinPm, 'packages').blocking).toBe(true)
    expect(byId(sinPm, 'packages').commands).toEqual([])
  })

  it('avisa con poco disco y bloquea sin espacio', () => {
    expect(byId(evaluate(probe({ diskFreeMb: 1500 })), 'disk')).toMatchObject({ ok: false, blocking: false })
    expect(byId(evaluate(probe({ diskFreeMb: 400 })), 'disk')).toMatchObject({ ok: false, blocking: true })
  })

  it('trata la red caída como aviso, no como bloqueo', () => {
    const list = evaluate(probe({ network: false }))
    expect(byId(list, 'network')).toMatchObject({ ok: false, blocking: false })
    expect(byId(list, 'network').commands).toContain('ping -c 1 1.1.1.1')
  })

  it('genera comandos distintos por gestor', () => {
    for (const [pm, expected] of [
      ['apt', 'sudo apt-get install -y policykit-1'],
      ['dnf', 'sudo dnf install -y polkit'],
      ['pacman', 'sudo pacman -S --needed polkit']
    ] as const) {
      expect(fixCommands(pm, 'elevation')).toEqual([expected])
    }
    expect(fixCommands(null, 'elevation')).toEqual([])
  })

  it('propone actualizar índices y luego instalar, sin romper `sudo env`', () => {
    const commands = fixCommands('apt', 'packages')
    expect(commands).toContain('sudo env DEBIAN_FRONTEND=noninteractive apt-get update')
    expect(commands.at(-1)).toMatch(/^sudo apt-get install -y /)
    expect(fixCommands('pacman', 'packages')[0]).toMatch(/^sudo pacman -S --needed /)
  })
})

describe('paquetes del sistema', () => {
  it('incluye SQLite y fija la versión de PHP cuando se conoce', () => {
    const conVersion = requiredPackages('apt', '8.5')
    expect(conVersion).toContain('php8.5-fpm')
    expect(conVersion).toContain('php8.5-sqlite3')
    expect(requiredPackages('apt', null)).toContain('php-sqlite3')
  })

  it('aporta ext-posix en Fedora y el paquete único en Arch', () => {
    expect(requiredPackages('dnf', null)).toContain('php-process')
    expect(requiredPackages('pacman', null)).toEqual(expect.arrayContaining(['php', 'nginx', 'composer']))
  })

  it('construye el comando de instalación y el de actualización', () => {
    expect(installArgs('apt', ['nginx'])).toEqual({
      cmd: 'env',
      args: ['DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', 'nginx']
    })
    expect(installArgs('dnf', ['nginx']).cmd).toBe('dnf')
    expect(installArgs('pacman', ['nginx']).args).toEqual(['-S', '--needed', '--noconfirm', 'nginx'])
    expect(updateArgs('pacman')).toBeNull()
    expect(updateArgs('apt')?.args).toContain('update')
  })
})

describe('consulta de paquetes instalados', () => {
  it('interpreta dpkg y detecta los que faltan', () => {
    const stdout = 'nginx\tinstall ok installed\nphp-cli\tinstall ok installed\n'
    expect(parseMissing('apt', ['nginx', 'php-cli', 'composer'], stdout)).toEqual(['composer'])
  })

  it('interpreta rpm y detecta los que faltan', () => {
    const stdout = 'nginx\npackage composer is not installed\n'
    expect(parseMissing('dnf', ['nginx', 'composer'], stdout)).toEqual(['composer'])
  })

  it('interpreta pacman -T, que ya devuelve solo los ausentes', () => {
    expect(parseMissing('pacman', ['nginx', 'composer'], 'composer\n')).toEqual(['composer'])
    expect(parseMissing('pacman', ['nginx'], '')).toEqual([])
  })

  it('usa una consulta por gestor', () => {
    expect(missingQuery('apt', ['nginx']).cmd).toBe('dpkg-query')
    expect(missingQuery('dnf', ['nginx']).cmd).toBe('rpm')
    expect(missingQuery('pacman', ['nginx']).args).toEqual(['-T', 'nginx'])
  })
})
