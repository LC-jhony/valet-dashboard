import { describe, expect, it } from 'vitest'
import {
  DATABASE_DRIVERS, NODE_MANAGERS, PROJECT_NAME_RE,
  buildLaravelArgs, databaseChoices, databaseEnv, defaultAnswers, defaultDatabasePort,
  formatCommand, laravelCommand, parseInstallerFlags, patchEnv, pdoDriversToDatabases,
  projectEnvValues, validateAnswers, validateDatabase,
  type DatabaseConnection, type LaravelAnswers, type LaravelCapabilities
} from './laravel'

const answers = (patch: Partial<LaravelAnswers> = {}): LaravelAnswers => ({ ...defaultAnswers(), name: 'mi-app', ...patch })

const caps = (patch: Partial<LaravelCapabilities> = {}): LaravelCapabilities => ({
  flags: null,
  databases: [...DATABASE_DRIVERS],
  nodeManagers: [...NODE_MANAGERS],
  ...patch
})

const connection: DatabaseConnection = {
  host: '127.0.0.1', port: 3306, database: 'mi_app', username: 'root', password: 's3creto'
}

describe('buildLaravelArgs: el asistente se traduce a flags deterministas', () => {
  it('crea el esqueleto Blade sin autenticación', () => {
    expect(buildLaravelArgs(answers())).toEqual([
      'mi-app', '--no-authentication', '--pest', '--no-boost', '--npm',
      '--database=sqlite', '--no-interaction', '--no-ansi'
    ])
  })

  it('un starter kit no lleva --no-authentication', () => {
    const args = buildLaravelArgs(answers({ useStarterKit: true, starterKit: 'react' }))
    expect(args).toContain('--react')
    expect(args).not.toContain('--no-authentication')
    expect(args).not.toContain('--workos')
  })

  it('Livewire con equipos los añade con archivo único', () => {
    const args = buildLaravelArgs(answers({
      useStarterKit: true, starterKit: 'livewire', livewireSingleFile: true, teams: true
    }))
    expect(args).toContain('--livewire')
    expect(args).toContain('--teams')
    expect(args).not.toContain('--livewire-class-components')
  })

  it('Livewire con clases pide sus flags y no equipos', () => {
    const args = buildLaravelArgs(answers({
      useStarterKit: true, starterKit: 'livewire', livewireSingleFile: false, teams: true
    }))
    expect(args).toContain('--livewire')
    expect(args).toContain('--livewire-class-components')
    expect(args).not.toContain('--teams')
  })

  it('Livewire de archivo único no pide los componentes de clase', () => {
    expect(buildLaravelArgs(answers({ useStarterKit: true, starterKit: 'livewire' })))
      .not.toContain('--livewire-class-components')
  })

  it('WorkOS solo se pide con starter kit', () => {
    expect(buildLaravelArgs(answers({ useStarterKit: true, authProvider: 'workos' }))).toContain('--workos')
    expect(buildLaravelArgs(answers({ authProvider: 'workos' }))).not.toContain('--workos')
  })

  it('sin starter kit conserva el stack elegido y quita la autenticación', () => {
    const args = buildLaravelArgs(answers({ frontendStack: 'vue' }))
    expect(args).toContain('--vue')
    expect(args).toContain('--no-authentication')
  })

  it('respeta PHPUnit, Boost, Node, Git y la base de datos', () => {
    const args = buildLaravelArgs(answers({
      testing: 'phpunit', boost: true, node: 'pnpm', git: true, database: 'pgsql'
    }))
    expect(args).toContain('--phpunit')
    expect(args).not.toContain('--pest')
    expect(args).toContain('--boost')
    expect(args).not.toContain('--no-boost')
    expect(args).toContain('--pnpm')
    expect(args).toContain('--git')
    expect(args).toContain('--database=pgsql')
  })

  it('sin Node pide --no-node', () => {
    expect(buildLaravelArgs(answers({ node: 'none' }))).toContain('--no-node')
  })

  it('omite las flags que un instalador antiguo no conoce', () => {
    const args = buildLaravelArgs(
      answers({ useStarterKit: true, starterKit: 'react', node: 'none', database: 'sqlite' }),
      ['--react', '--pest', '--database', '--no-interaction']
    )
    expect(args).toContain('--react')
    expect(args).not.toContain('--no-node')
    expect(args).not.toContain('--no-boost')
  })

  it('siempre termina en modo no interactivo y sin color', () => {
    for (const a of [answers(), answers({ useStarterKit: true, starterKit: 'svelte' })]) {
      const args = buildLaravelArgs(a)
      expect(args.slice(-2)).toEqual(['--no-interaction', '--no-ansi'])
    }
  })
})

describe('comando visible', () => {
  it('escapa los argumentos con espacios y conserva los simples', () => {
    expect(formatCommand(['laravel', 'new', 'mi app'])).toBe("laravel new 'mi app'")
  })

  it('nunca incluye la contraseña de la base de datos', () => {
    const command = laravelCommand(answers({ database: 'mysql' }))
    expect(command).not.toContain('s3creto')
    expect(command).not.toContain('DB_PASSWORD')
  })
})

describe('parseInstallerFlags', () => {
  it('lee las opciones de la ayuda real del instalador', () => {
    const help = [
      '      --database=DATABASE          The database driver your application will use.',
      '      --react                      Install the React Starter Kit',
      '      --no-node                    Skip installing and building NPM dependencies',
      '  -n, --no-interaction             Do not ask any interactive question',
      '      --ansi|--no-ansi             Force (or disable --no-ansi) ANSI output'
    ].join('\n')
    const flags = parseInstallerFlags(help)
    expect(flags).toContain('--database')
    expect(flags).toContain('--react')
    expect(flags).toContain('--no-node')
    expect(flags).toContain('--no-interaction')
    expect(flags).toContain('--no-ansi')
  })

  it('no inventa flags cuando no hay ninguna', () => {
    expect(parseInstallerFlags('sin opciones')).toBeNull()
  })
})

describe('capacidades del sistema', () => {
  it('traduce las extensiones PDO a motores', () => {
    expect(pdoDriversToDatabases(['PDO', 'pdo_mysql', 'pdo_pgsql'])).toEqual(['mysql', 'mariadb', 'pgsql'])
    expect(pdoDriversToDatabases(['pdo_sqlite'])).toEqual(['sqlite'])
    expect(pdoDriversToDatabases([])).toEqual([])
  })

  it('marca cada motor en el orden estable de la interfaz', () => {
    const choices = databaseChoices(['pgsql'])
    expect(choices.map((c) => c.driver)).toEqual(DATABASE_DRIVERS)
    expect(choices.find((c) => c.driver === 'pgsql')?.available).toBe(true)
    expect(choices.find((c) => c.driver === 'sqlite')?.available).toBe(false)
  })

  it('usa el puerto por defecto de cada motor', () => {
    expect(defaultDatabasePort('mysql')).toBe(3306)
    expect(defaultDatabasePort('pgsql')).toBe(5432)
    expect(defaultDatabasePort('sqlite')).toBe(0)
  })
})

describe('validateAnswers', () => {
  it('acepta la configuración por defecto cuando todo está disponible', () => {
    expect(validateAnswers(answers(), caps())).toEqual([])
  })

  it('rechaza nombres que no son carpeta y sitio válidos', () => {
    for (const name of ['', 'Mi-App', '-app', 'app-', 'con espacio', 'a'.repeat(64)]) {
      expect(PROJECT_NAME_RE.test(name)).toBe(false)
      expect(validateAnswers(answers({ name }), caps()).length).toBeGreaterThan(0)
    }
  })

  it('rechaza una base de datos sin extensión PDO', () => {
    expect(validateAnswers(answers({ database: 'sqlite' }), caps({ databases: ['mysql'] })))
      .toContain('SQLite is not available: its PDO extension is missing in PHP.')
  })

  it('rechaza un gestor de Node que no está instalado', () => {
    expect(validateAnswers(answers({ node: 'bun' }), caps({ nodeManagers: ['npm'] })))
      .toContain('bun was not found on this system.')
  })

  it('rechaza flags que el instalador no anuncia', () => {
    const errors = validateAnswers(answers({ useStarterKit: true, starterKit: 'react' }), caps({ flags: ['--pest'] }))
    expect(errors.some((e) => e.includes('--react'))).toBe(true)
    expect(errors.some((e) => e.includes('--database'))).toBe(true)
  })

  it('no exige WorkOS ni equipos cuando no aplican', () => {
    expect(validateAnswers(answers(), caps({ flags: ['--no-authentication', '--pest', '--npm', '--database'] }))).toEqual([])
  })
})

describe('credenciales de base de datos', () => {
  it('valida host, puerto, nombre y usuario', () => {
    expect(validateDatabase(connection)).toEqual([])
    expect(validateDatabase({ ...connection, port: 0 }).length).toBe(1)
    expect(validateDatabase({ ...connection, database: 'mi-app' }).length).toBe(1)
    expect(validateDatabase({ ...connection, username: '' }).length).toBe(1)
  })

  it('construye las variables que leerá artisan migrate', () => {
    expect(databaseEnv('mysql', connection)).toEqual({
      DB_CONNECTION: 'mysql', DB_HOST: '127.0.0.1', DB_PORT: '3306',
      DB_DATABASE: 'mi_app', DB_USERNAME: 'root', DB_PASSWORD: 's3creto'
    })
  })

  it('SQLite no escribe credenciales y las demás sí', () => {
    expect(projectEnvValues('sqlite', connection, null)).toEqual({})
    expect(projectEnvValues('mysql', connection, null)).toMatchObject({ DB_CONNECTION: 'mysql' })
    expect(projectEnvValues('mysql', connection, 'http://mi-app.test')).toMatchObject({
      DB_PASSWORD: 's3creto', APP_URL: 'http://mi-app.test'
    })
  })
})

describe('patchEnv', () => {
  it('reemplaza valores existentes sin tocar el resto', () => {
    const env = 'APP_NAME=Laravel\nDB_CONNECTION=sqlite\nAPP_ENV=local\n'
    const out = patchEnv(env, { DB_CONNECTION: 'mysql', APP_URL: 'http://mi-app.test' })
    expect(out).toContain('APP_NAME=Laravel')
    expect(out).toContain('APP_ENV=local')
    expect(out).toContain('DB_CONNECTION=mysql')
    expect(out).toContain('APP_URL=http://mi-app.test')
    expect(out.match(/DB_CONNECTION=/g)).toHaveLength(1)
  })

  it('descomenta las claves que el instalador deja comentadas con SQLite', () => {
    const env = '# DB_HOST=127.0.0.1\n# DB_PORT=3306\n# DB_DATABASE=laravel\n# DB_USERNAME=root\n# DB_PASSWORD=\n'
    const out = patchEnv(env, databaseEnv('mysql', connection))
    expect(out).toContain('DB_HOST=127.0.0.1')
    expect(out).toContain('DB_PORT=3306')
    expect(out).toContain('DB_DATABASE=mi_app')
    expect(out).toContain('DB_USERNAME=root')
    expect(out).toContain('DB_PASSWORD=s3creto')
    expect(out).not.toContain('# DB_HOST')
  })

  it('entrecomilla valores con espacios o caracteres especiales', () => {
    const out = patchEnv('APP_NAME=laravel\n', { DB_PASSWORD: 'con espacio y "comillas"' })
    expect(out).toContain('DB_PASSWORD="con espacio y \\"comillas\\""')
  })

  it('escapa el dólar y los saltos de línea para que Dotenv no los interprete', () => {
    const out = patchEnv('APP_NAME=laravel\n', { DB_PASSWORD: 'pa$sw\nrd' })
    expect(out).toContain('DB_PASSWORD="pa\\$sw\\nrd"')
  })

  it('añade la clave al final si no existía', () => {
    expect(patchEnv('APP_NAME=Laravel', { APP_URL: 'http://x.test' }))
      .toBe('APP_NAME=Laravel\nAPP_URL=http://x.test\n')
  })
})
