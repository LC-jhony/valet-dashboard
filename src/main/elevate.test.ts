import { describe, expect, it } from 'vitest'
import { planElevation } from './elevate'

describe('plan de elevación', () => {
  it('prefiere pkexec cuando existe, aunque haya askpass', () => {
    expect(planElevation(true, true, '/ruta/askpass')).toEqual({ cmd: 'pkexec', prefix: [] })
  })

  it('cae a sudo -A cuando no hay pkexec pero sí askpass', () => {
    expect(planElevation(false, true, '/ruta/askpass')).toEqual({ cmd: '/usr/bin/sudo', prefix: ['-A'] })
  })

  it('no elige nada si falta sudo o el askpass', () => {
    expect(planElevation(false, false, '/ruta/askpass')).toBeNull()
    expect(planElevation(false, true, null)).toBeNull()
  })
})
