// Modelo puro de la creación de proyectos con `laravel new`. Recibe las
// respuestas del asistente y devuelve el comando exacto, los errores de
// validación o el parche de `.env`. Sin acceso al sistema: así la interfaz y el
// proceso principal comparten las mismas reglas y se pueden probar aisladas.

export type FrontendStack = 'blade' | 'react' | 'svelte' | 'vue' | 'livewire'
/** Starter kit = stack con autenticación. Blade no es un kit. */
export type StarterKit = Exclude<FrontendStack, 'blade'>
export type AuthProvider = 'laravel' | 'workos'
export type TestingFramework = 'pest' | 'phpunit'
export type DatabaseDriver = 'sqlite' | 'mysql' | 'mariadb' | 'pgsql' | 'sqlsrv'
export type NodeManager = 'npm' | 'pnpm' | 'bun' | 'yarn'

export const DATABASE_DRIVERS: DatabaseDriver[] = ['sqlite', 'mysql', 'mariadb', 'pgsql', 'sqlsrv']
export const NODE_MANAGERS: NodeManager[] = ['npm', 'pnpm', 'bun', 'yarn']
export const FRONTEND_STACKS: FrontendStack[] = ['blade', 'react', 'svelte', 'vue', 'livewire']

export const DATABASE_LABELS: Record<DatabaseDriver, string> = {
  sqlite: 'SQLite',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  pgsql: 'PostgreSQL',
  sqlsrv: 'SQL Server'
}

export const STACK_LABELS: Record<FrontendStack, string> = {
  blade: 'Blade',
  react: 'React',
  svelte: 'Svelte',
  vue: 'Vue',
  livewire: 'Livewire'
}

/** Mismo nombre que acepta el panel como carpeta y sitio de Valet. */
export const PROJECT_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export interface LaravelAnswers {
  name: string
  /** `true` instala un starter kit (con autenticación); `false` solo el esqueleto. */
  useStarterKit: boolean
  starterKit: StarterKit
  /** Stack cuando no hay starter kit. Blade deja el esqueleto clásico. */
  frontendStack: FrontendStack
  authProvider: AuthProvider
  /** Componentes Livewire de archivo único; si es `false`, componentes de clase. */
  livewireSingleFile: boolean
  teams: boolean
  testing: TestingFramework
  boost: boolean
  node: NodeManager | 'none'
  git: boolean
  database: DatabaseDriver
}

export interface DatabaseConnection {
  host: string
  port: number
  database: string
  username: string
  password: string
}

export interface LaravelCapabilities {
  /** Opciones que acepta el instalador; `null` si no se pudo leer su ayuda. */
  flags: string[] | null
  databases: DatabaseDriver[]
  nodeManagers: NodeManager[]
}

/** Respuestas de partida del asistente. La base de datos se ajusta a lo disponible. */
export function defaultAnswers(): LaravelAnswers {
  return {
    name: '',
    useStarterKit: false,
    starterKit: 'react',
    frontendStack: 'blade',
    authProvider: 'laravel',
    livewireSingleFile: true,
    teams: false,
    testing: 'pest',
    boost: false,
    node: 'npm',
    git: false,
    database: 'sqlite'
  }
}

const supports = (flags: string[] | null, flag: string): boolean => flags === null || flags.includes(flag)

/**
 * Argumentos de `laravel new`. Siempre no interactivo: el asistente ya ha
 * respondido. `flags` permite omitir opciones que una versión antigua no
 * conoce; la validación se encarga de rechazar las que sí importan.
 */
export function buildLaravelArgs(a: LaravelAnswers, flags: string[] | null = null): string[] {
  const args = [a.name]

  if (a.useStarterKit) {
    args.push(`--${a.starterKit}`)
    if (a.authProvider === 'workos' && supports(flags, '--workos')) args.push('--workos')
    if (a.starterKit === 'livewire' && a.authProvider === 'laravel' &&
      !a.livewireSingleFile && supports(flags, '--livewire-class-components')) {
      args.push('--livewire-class-components')
    }
    if (a.teams && a.starterKit === 'livewire' && a.authProvider === 'laravel' && a.livewireSingleFile &&
      supports(flags, '--teams')) {
      args.push('--teams')
    }
  } else {
    if (a.frontendStack !== 'blade') args.push(`--${a.frontendStack}`)
    if (supports(flags, '--no-authentication')) args.push('--no-authentication')
  }

  args.push(a.testing === 'pest' ? '--pest' : '--phpunit')
  if (a.boost) args.push('--boost')
  else if (supports(flags, '--no-boost')) args.push('--no-boost')

  if (a.node !== 'none') args.push(`--${a.node}`)
  else if (supports(flags, '--no-node')) args.push('--no-node')

  if (a.git) args.push('--git')
  args.push(`--database=${a.database}`)
  args.push('--no-interaction', '--no-ansi')
  return args
}

/** Comando legible; las contraseñas nunca viajan como argumento. */
export function formatCommand(parts: string[]): string {
  return parts.map((p) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)).join(' ')
}

/** `laravel new …` listo para mostrar en el resumen. */
export const laravelCommand = (a: LaravelAnswers, flags: string[] | null = null): string =>
  formatCommand(['laravel', 'new', ...buildLaravelArgs(a, flags)])

/** Opciones que el instalador anuncia en su ayuda. `null` si no hay ninguna. */
export function parseInstallerFlags(help: string): string[] | null {
  const flags = new Set<string>()
  for (const match of help.matchAll(/(?<![\w-])(--[a-z][a-z0-9-]*)/g)) flags.add(match[1])
  return flags.size ? [...flags].sort() : null
}

/** Extensiones PDO cargadas (`pdo_mysql`, …) a motores que entiende el instalador. */
export function pdoDriversToDatabases(extensions: string[]): DatabaseDriver[] {
  const set = new Set(extensions.map((e) => e.trim().toLowerCase()))
  const drivers: DatabaseDriver[] = []
  if (set.has('pdo_sqlite')) drivers.push('sqlite')
  if (set.has('pdo_mysql')) drivers.push('mysql', 'mariadb')
  if (set.has('pdo_pgsql')) drivers.push('pgsql')
  if (set.has('pdo_sqlsrv')) drivers.push('sqlsrv')
  return drivers
}

/** Motores con su disponibilidad real, en el orden que muestra la interfaz. */
export function databaseChoices(available: DatabaseDriver[]): { driver: DatabaseDriver; available: boolean }[] {
  return DATABASE_DRIVERS.map((driver) => ({ driver, available: available.includes(driver) }))
}

/**
 * Errores que impiden crear el proyecto. Vacío significa que se
 * puede ejecutar. `flags` es lo que el instalador instalado entiende.
 */
export function validateAnswers(a: LaravelAnswers, caps: LaravelCapabilities): string[] {
  const errors: string[] = []
  if (!PROJECT_NAME_RE.test(a.name)) {
    errors.push('Invalid name: use lowercase letters, numbers and hyphens, without starting or ending with a hyphen (max. 63).')
  }
  if (!DATABASE_DRIVERS.includes(a.database)) {
    errors.push(`Unknown database: ${String(a.database)}`)
  } else if (!caps.databases.includes(a.database)) {
    errors.push(`${DATABASE_LABELS[a.database]} is not available: its PDO extension is missing in PHP.`)
  }
  if (!FRONTEND_STACKS.includes(a.frontendStack)) errors.push(`Unknown frontend stack: ${String(a.frontendStack)}`)
  if (!STACK_LABELS[a.starterKit]) errors.push(`Unknown starter kit: ${String(a.starterKit)}`)
  if (a.authProvider !== 'laravel' && a.authProvider !== 'workos') errors.push('Invalid authentication provider.')
  if (a.testing !== 'pest' && a.testing !== 'phpunit') errors.push('Invalid test framework.')
  if (a.node !== 'none' && !NODE_MANAGERS.includes(a.node)) errors.push(`Unknown Node manager: ${String(a.node)}`)

  const flags = caps.flags
  const need = (flag: string, what: string) => {
    if (!supports(flags, flag)) errors.push(`${what} is not available in your Laravel installer (${flag}). Update it.`)
  }

  if (a.useStarterKit) {
    need(`--${a.starterKit}`, `The ${STACK_LABELS[a.starterKit]} starter kit`)
    if (a.authProvider === 'workos') need('--workos', 'WorkOS')
    if (a.starterKit === 'livewire' && a.authProvider === 'laravel' && !a.livewireSingleFile) {
      need('--livewire-class-components', 'Class-based Livewire components')
    }
    if (a.teams && a.starterKit === 'livewire' && a.authProvider === 'laravel' && a.livewireSingleFile) {
      need('--teams', 'Team support')
    }
  } else {
    if (a.frontendStack !== 'blade') need(`--${a.frontendStack}`, `The ${STACK_LABELS[a.frontendStack]} stack`)
    need('--no-authentication', 'The skeleton without authentication')
  }

  if (a.testing === 'pest') need('--pest', 'Pest')
  else need('--phpunit', 'PHPUnit')
  if (a.boost) need('--boost', 'Laravel Boost')
  if (a.node !== 'none') {
    if (!caps.nodeManagers.includes(a.node)) errors.push(`${a.node} was not found on this system.`)
    else need(`--${a.node}`, `The ${a.node} manager`)
  }
  need('--database', 'The database choice')
  return errors
}

const defaultPorts: Record<DatabaseDriver, number> = {
  sqlite: 0,
  mysql: 3306,
  mariadb: 3306,
  pgsql: 5432,
  sqlsrv: 1433
}

export const defaultDatabasePort = (driver: DatabaseDriver): number => defaultPorts[driver]

/** Validación de las credenciales. La contraseña puede ir vacía. */
export function validateDatabase(connection: DatabaseConnection): string[] {
  const errors: string[] = []
  if (!connection.host.trim() || /\s/.test(connection.host)) errors.push('The database host is not valid.')
  if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) {
    errors.push('The database port must be between 1 and 65535.')
  }
  if (!/^[A-Za-z0-9_]+$/.test(connection.database)) {
    errors.push('The database name only allows letters, numbers and underscores.')
  }
  if (!connection.username.trim() || /\s/.test(connection.username)) {
    errors.push('The database user is not valid.')
  }
  return errors
}

/**
 * Variables que `artisan migrate` leerá del entorno. Dotenv no pisa variables
 * ya definidas, así que pasarlas al proceso evita escribir la contraseña en
 * los argumentos (visibles en `ps`).
 */
export function databaseEnv(driver: DatabaseDriver, connection: DatabaseConnection): Record<string, string> {
  return {
    DB_CONNECTION: driver,
    DB_HOST: connection.host.trim(),
    DB_PORT: String(connection.port),
    DB_DATABASE: connection.database,
    DB_USERNAME: connection.username.trim(),
    DB_PASSWORD: connection.password
  }
}

const safeEnvValue = /^[A-Za-z0-9_./:@%+-]*$/

const quoteEnvValue = (value: string): string =>
  safeEnvValue.test(value)
    ? value
    : `"${value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')}"`

/**
 * Reescribe claves de un `.env` conservando el resto del archivo. Las líneas
 * comentadas (`# DB_HOST=…`) se descomentan porque el instalador las deja así
 * cuando elige SQLite.
 */
export function patchEnv(content: string, values: Record<string, string>): string {
  let out = content
  for (const [key, raw] of Object.entries(values)) {
    const line = `${key}=${quoteEnvValue(raw)}`
    const re = new RegExp(`^(?:#\\s*)?${key}=.*$`, 'm')
    if (re.test(out)) out = out.replace(re, line)
    else out = `${out.replace(/\n*$/, '\n')}${line}\n`
  }
  return out
}

/** Valores que se escriben en `.env` tras crear el proyecto. */
export function projectEnvValues(
  driver: DatabaseDriver,
  connection: DatabaseConnection | null,
  appUrl: string | null
): Record<string, string> {
  const values: Record<string, string> = {}
  if (driver !== 'sqlite' && connection) Object.assign(values, databaseEnv(driver, connection))
  if (appUrl) values.APP_URL = appUrl
  return values
}
