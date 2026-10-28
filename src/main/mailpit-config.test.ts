import { describe, expect, it } from 'vitest'
import { defaultConfig, validateConfig, writeAuxiliary, AUX_DIR, MAILPIT_DATA_DIR } from './mailpit-config'
import { join } from 'node:path'

const withOptions = (options: Record<string, string>) => {
  const base = defaultConfig()
  return { ...base, options: { ...base.options, ...options } }
}

describe('validateConfig: rutas confinadas', () => {
  it('acepta la configuración por defecto', () => {
    expect(() => validateConfig(defaultConfig())).not.toThrow()
  })

  it('acepta una base de datos dentro del directorio del panel', () => {
    expect(() => validateConfig(withOptions({ MP_DATABASE: join(MAILPIT_DATA_DIR, 'otra.db') }))).not.toThrow()
  })

  it('acepta una URL de rqlite', () => {
    expect(() => validateConfig(withOptions({ MP_DATABASE: 'http://127.0.0.1:4001' }))).not.toThrow()
  })

  it('rechaza una base de datos fuera del directorio del panel', () => {
    expect(() => validateConfig(withOptions({ MP_DATABASE: '/home/usuario/.ssh/id_rsa' })))
      .toThrow(/database must be inside/i)
  })

  it('rechaza el escape con .. en la base de datos', () => {
    expect(() => validateConfig(withOptions({ MP_DATABASE: join(MAILPIT_DATA_DIR, '..', '..', 'x.db') })))
      .toThrow(/database/i)
  })

  it('rechaza un registro fuera del directorio de datos', () => {
    expect(() => validateConfig(withOptions({ MP_LOG_FILE: '/etc/shadow' })))
      .toThrow(/log file must be inside/i)
  })

  it('rechaza un YAML de etiquetas fuera de la carpeta gestionada', () => {
    expect(() => validateConfig(withOptions({ MP_TAGS_CONFIG: '/home/usuario/.bashrc' })))
      .toThrow(/tags YAML must be inside/i)
  })

  it('acepta un YAML de etiquetas dentro de la carpeta gestionada', () => {
    expect(() => validateConfig(withOptions({ MP_TAGS_CONFIG: join(AUX_DIR, 'tags.yml') }))).not.toThrow()
  })

  it('rechaza relay y forward fuera de la carpeta gestionada', () => {
    expect(() => validateConfig(withOptions({ MP_SMTP_RELAY_CONFIG: '/tmp/relay.yml' }))).toThrow()
    expect(() => validateConfig(withOptions({ MP_SMTP_FORWARD_CONFIG: '/tmp/forward.yml' }))).toThrow()
  })
})

describe('validateConfig: binario del sistema', () => {
  it('rechaza un binario fuera de las carpetas de confianza', () => {
    const config = { ...defaultConfig(), binarySource: 'system' as const, systemBinary: '/tmp/mailpit' }
    expect(() => validateConfig(config)).toThrow(/trusted folder/i)
  })

  it('acepta una ruta de confianza aunque no exista (la comprobación de existencia es aparte)', () => {
    const config = { ...defaultConfig(), binarySource: 'system' as const, systemBinary: '/usr/bin/mailpit-no-existe' }
    expect(() => validateConfig(config)).toThrow(/does not exist/i)
  })
})

describe('writeAuxiliary', () => {
  it('no escribe fuera de la carpeta gestionada aunque la config lo pida', async () => {
    const config = withOptions({ MP_TAGS_CONFIG: '/tmp/fuera.yml' })
    await expect(writeAuxiliary(config, 'tags', 'filters: []')).rejects.toThrow(/Tags must be inside/i)
  })
})
