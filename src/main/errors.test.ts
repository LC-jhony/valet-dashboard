import { describe, expect, it } from 'vitest'
import { classify } from './errors'

describe('clasificación de errores de instalación', () => {
  it('reconoce el bloqueo del gestor de paquetes', () => {
    const e = classify({
      cmd: 'pkexec', code: 100, pm: 'apt',
      stderr: 'E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 1234'
    })
    expect(e.title).toBe('Otro gestor de paquetes está en uso')
    expect(e.commands).toContain('ps aux | grep -E "apt|dpkg"')
  })

  it('reconoce el disco lleno', () => {
    const e = classify({ cmd: 'apt-get', code: 1, stderr: 'E: No space left on device' })
    expect(e.title).toBe('Disco lleno')
    expect(e.commands).toContain('df -h /')
  })

  it('reconoce la falta de red', () => {
    const e = classify({ cmd: 'apt-get', code: 100, pm: 'apt', stderr: 'Temporary failure resolving deb.debian.org' })
    expect(e.title).toBe('Sin red o DNS roto')
    expect(e.commands).toContain('sudo apt-get update')
  })

  it('extrae el paquete que no existe', () => {
    const e = classify({ cmd: 'apt-get', code: 100, pm: 'apt', stderr: 'E: Unable to locate package php8.5-fpm' })
    expect(e.title).toContain('php8.5-fpm')
    expect(e.commands).toContain('sudo apt-get install -y php8.5-fpm')
  })

  it('reconoce conflictos de dnf y paquetes ausentes en pacman', () => {
    expect(classify({ cmd: 'dnf', code: 1, pm: 'dnf', stderr: 'Transaction check error: file /x conflicts' }).title)
      .toBe('Conflicto entre paquetes')
    expect(classify({ cmd: 'pacman', code: 1, pm: 'pacman', stderr: 'error: target not found: nginx' }).title)
      .toBe('Paquete no disponible en pacman')
  })

  it('traduce la cancelación del diálogo de polkit', () => {
    expect(classify({ cmd: 'pkexec', code: 126 }).title).toBe('Autenticación cancelada')
    expect(classify({ cmd: 'pkexec', code: 127 }).title).toBe('Autenticación cancelada')
  })

  it('no confunde un binario ausente (también 127) con autenticación cancelada', () => {
    const e = classify({ cmd: 'pkexec', code: 127, stderr: 'pkexec: command not found' })
    expect(e.title).toBe('No se encontró pkexec')
  })

  it('distingue el tiempo agotado', () => {
    const e = classify({ cmd: 'apt-get', code: null, killed: true, pm: 'apt' })
    expect(e.title).toBe('El comando no terminó a tiempo')
    expect(e.commands[0]).toContain('apt')
  })

  it('cae en un mensaje genérico con las últimas líneas', () => {
    const e = classify({ cmd: 'valet', code: 1, stderr: 'línea 1\nlínea 2\nlínea 3\nlínea 4' })
    expect(e.title).toBe('Falló valet')
    expect(e.detail).toContain('línea 4')
    expect(e.detail).not.toContain('línea 1')
    expect(e.commands).toEqual([])
  })
})
