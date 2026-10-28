import { describe, expect, it } from 'vitest'
import {
  isNewer, latestComposerVersion, latestNodeLts, latestPackagistVersion, parseAptUpgradable,
  parseComposerVersion, parseDnfCheckUpdate, parseDnsmasqVersion, parseNginxVersion,
  parseNodeVersion, parsePacmanQu, parseValetVersion, upstream, upgradeArgs
} from './updates'

describe('qué actualizaciones hay', () => {
  it('lee apt list --upgradable con las dos versiones', () => {
    const out = parseAptUpgradable([
      'Listing...',
      'php8.5-cli/noble-updates 8.5.4-0ubuntu1.6 amd64 [upgradable from: 8.5.4-0ubuntu1.5]',
      'nginx/noble-updates 1.28.3-1ubuntu1 amd64 [upgradable from: 1.28.2-1ubuntu1]',
      ''
    ].join('\n'))
    expect(out['php8.5-cli']).toEqual({ latest: '8.5.4-0ubuntu1.6', current: '8.5.4-0ubuntu1.5' })
    expect(out.nginx.latest).toBe('1.28.3-1ubuntu1')
    expect(Object.keys(out)).toHaveLength(2)
  })

  it('ignora el encabezado de dnf y acepta sus arquitecturas', () => {
    const out = parseDnfCheckUpdate([
      'Last metadata expiration check: 0:12:03 ago on Wed 28 Oct 2026.',
      'php-cli.x86_64          8.5.4-1.fc41            updates',
      'nginx.x86_64            1.28.3-1.fc41           updates',
      'nodejs.aarch64          22.11.0-1.fc41          updates'
    ].join('\n'))
    expect(out['php-cli'].latest).toBe('8.5.4-1.fc41')
    expect(out.nodejs.latest).toBe('22.11.0-1.fc41')
    expect(out.x86_64).toBeUndefined()
  })

  it('lee pacman -Qu con versión antigua y nueva', () => {
    const out = parsePacmanQu([
      'nginx 1.28.2-1 -> 1.28.3-1',
      'php 8.5.4-1 -> 8.5.5-1',
      ''
    ].join('\n'))
    expect(out.nginx).toEqual({ current: '1.28.2-1', latest: '1.28.3-1' })
    expect(out.php.latest).toBe('8.5.5-1')
  })
})

describe('comparar versiones', () => {
  it('quita la época y la revisión del paquete', () => {
    expect(upstream('1:8.5.4-1ubuntu1')).toBe('8.5.4')
    expect(upstream('v2.4.5')).toBe('2.4.5')
    expect(upstream('2.90-2ubuntu0.1')).toBe('2.90')
  })

  it('compara tramo a tramo, no como texto', () => {
    expect(isNewer('2.10.0', '2.9.9')).toBe(true)
    expect(isNewer('2.9.9', '2.10.0')).toBe(false)
    expect(isNewer('8.5.5', '8.5.4')).toBe(true)
    expect(isNewer('8.5.4', '8.5.4')).toBe(false)
    expect(isNewer('24.21.0', '24.9.0')).toBe(true)
  })

  it('no inventa una actualización cuando falta un dato', () => {
    expect(isNewer('', '8.5.4')).toBe(false)
    expect(isNewer('8.5.5', '')).toBe(false)
  })
})

describe('versiones instaladas', () => {
  it('lee el formato de cada programa', () => {
    expect(parseComposerVersion('Composer version 2.10.3 2026-08-27 13:34:23')).toBe('2.10.3')
    expect(parseComposerVersion('Composer 2.9')).toBe('2.9')
    expect(parseValetVersion('Valet v2.4.5')).toBe('2.4.5')
    expect(parseValetVersion('Laravel Valet 3.7.0')).toBe('3.7.0')
    expect(parseNginxVersion('nginx version: nginx/1.28.3 (Ubuntu)')).toBe('1.28.3')
    expect(parseDnsmasqVersion('Dnsmasq version 2.92  Copyright (c) 2000-2025')).toBe('2.92')
    expect(parseDnsmasqVersion('Dnsmasq versión 2.92  Copyright (c) 2000-2025')).toBe('2.92')
    expect(parseNodeVersion('v24.21.0')).toBe('24.21.0')
  })

  it('devuelve vacío si la salida no es la esperada', () => {
    expect(parseComposerVersion('')).toBe('')
    expect(parseNginxVersion('nginx: command not found')).toBe('')
    expect(parseDnsmasqVersion('sin versión aquí')).toBe('')
  })
})

describe('últimas versiones publicadas', () => {
  it('toma la rama estable de getcomposer.org', () => {
    const json = JSON.stringify({ stable: [{ version: '2.10.4' }, { version: '2.10.3' }], preview: [] })
    expect(latestComposerVersion(json)).toBe('2.10.4')
    expect(latestComposerVersion('no es json')).toBe('')
  })

  it('toma la primera versión de packagist', () => {
    const json = JSON.stringify({
      packages: { 'cpriego/valet-linux': [{ version: 'v2.4.6' }, { version: 'v2.4.5' }] }
    })
    expect(latestPackagistVersion(json)).toBe('v2.4.6')
    expect(latestPackagistVersion('{}')).toBe('')
  })

  it('elige la primera LTS del índice de Node, no la última publicada', () => {
    const json = JSON.stringify([
      { version: 'v26.13.0', lts: false },
      { version: 'v24.21.0', lts: 'Krypton' },
      { version: 'v22.20.0', lts: 'Jod' }
    ])
    expect(latestNodeLts(json)).toBe('v24.21.0')
    expect(latestNodeLts('[]')).toBe('')
  })
})

describe('actualizar paquetes', () => {
  it('solo sube los paquetes indicados, sin tocar el resto', () => {
    expect(upgradeArgs('apt', ['php8.5-cli'])).toEqual({
      cmd: 'env',
      args: ['DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '--only-upgrade', 'php8.5-cli']
    })
    expect(upgradeArgs('dnf', ['nginx']).args).toEqual(['upgrade', '-y', 'nginx'])
    expect(upgradeArgs('pacman', ['nginx']).args).toEqual(['-S', '--noconfirm', 'nginx'])
  })
})
