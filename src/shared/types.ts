import type { MailpitApi } from './mailpit'
import type { DatabaseConnection, LaravelAnswers, LaravelCapabilities } from './laravel'

export type { MailpitApi } from './mailpit'
export type { DatabaseConnection, LaravelAnswers, LaravelCapabilities } from './laravel'

export interface Site { name: string; path: string; secure: boolean; kind: 'parked' | 'linked'; url: string }
export interface ProjectInfo {
  domain: string
  parkedPaths: string[]
  defaultDir: string
  httpPort: number
  composerAvailable: boolean
  valetAvailable: boolean
  /** Instalador de Laravel (`laravel new`). Si falta, se instala al crear. */
  installer: { available: boolean; version: string | null }
  /** Opciones reales que permiten el instalador, PHP y los gestores de Node. */
  capabilities: LaravelCapabilities
}
export interface CreateProjectOptions {
  /** Carpeta donde se creará el proyecto (nunca un enlace de Valet). */
  parentDir: string
  /** Respuestas del asistente, incluido el nombre del proyecto. */
  answers: LaravelAnswers
  /** Credenciales para `artisan migrate`; `null` con SQLite. */
  database: DatabaseConnection | null
}
export type CreateProjectEvent =
  | { type: 'stage'; label: string }
  | { type: 'log'; text: string }
  /** La creación falló y quedó una carpeta que el usuario puede eliminar. */
  | { type: 'incomplete'; path: string; message: string }
export interface PortUsage { port: number; process: string; pid: string }
export interface ApacheInfo { installed: boolean; active: boolean; enabled: boolean; http: number | null; https: number | null }
export interface PortsInfo {
  config: { http: number; https: number }
  usage: PortUsage[]
  nginxActive: boolean
  apache: ApacheInfo
}
export interface PhpInfo { versions: string[]; current: string }
export interface Service { name: string; active: boolean }
export type ServiceAction = 'start' | 'stop' | 'restart'

export type DnsMode = 'safe' | 'hosts' | 'classic'

export interface DnsInfo {
  domain: string
  networkManager: boolean
  resolvedActive: boolean
  dnsmasqBinary: boolean
  dnsmasqServiceActive: boolean
  dashboardActive: boolean
  port: number
  portFree: boolean
  resolvConfOk: boolean
  testResolves: boolean
}

export interface ComposerInfo {
  available: boolean
  globalHome: string
  isolatedHome: string
  isolatedValet: boolean
  conflict: boolean
  conflictDetail: string
}

export interface ValetInfo {
  installed: boolean
  path: string | null
  version: string | null
  isolated: boolean
}

export interface Api {
  sites: {
    list(): Promise<Site[]>
    secure(name: string, on: boolean): Promise<void>
    open(name: string): Promise<void>
    projectInfo(): Promise<ProjectInfo>
    pickDirectory(current?: string): Promise<string | null>
    create(opts: CreateProjectOptions): Promise<Site>
    cancelCreate(): Promise<void>
    /** Borra la última carpeta incompleta de una creación fallida. */
    deleteIncomplete(path: string): Promise<void>
    onCreateEvent(cb: (e: CreateProjectEvent) => void): () => void
  }
  php: { list(): Promise<PhpInfo>; use(version: string): Promise<void> }
  ports: {
    scan(): Promise<PortsInfo>
    set(http: number, https: number): Promise<void>
    setApache(http: number, https: number): Promise<void>
  }
  services: { list(): Promise<Service[]>; action(name: string, action: ServiceAction): Promise<void> }
  mailpit: MailpitApi
  updates: {
    /** Consulta versiones instaladas y disponibles; `force` ignora la caché. */
    check(force?: boolean): Promise<UpdatesInfo>
    run(id: UpdateId): Promise<void>
  }
  install: {
    check(): Promise<Env>
    start(opts: InstallOptions): Promise<void>
    cancel(): Promise<void>
    uninstall(pkg: string): Promise<void>
    repairDns(mode: DnsMode): Promise<void>
    syncHosts(): Promise<void>
    onEvent(cb: (e: InstallEvent) => void): () => void
  }
}

/** Requisitos que el panel no puede resolver por sí mismo. */
export type PrereqId = 'systemd' | 'elevation' | 'sudo' | 'askpass' | 'packages' | 'network' | 'disk'

export interface Prereq {
  id: PrereqId
  label: string
  ok: boolean
  /** Un requisito bloqueante impide instalar hasta que se resuelva. */
  blocking: boolean
  detail: string
  /** Comandos exactos para resolverlo a mano. Vacío si ya está resuelto. */
  commands: string[]
}

export interface Env {
  distro: string
  pm: string | null
  tools: Record<string, boolean>
  portHogs: string[]
  dns: DnsInfo
  composer: ComposerInfo
  valet: ValetInfo
  warnings: string[]
  recommendedDnsMode: DnsMode
  prereqs: Prereq[]
  /** Cómo se pedirá la contraseña de administrador. */
  elevation: 'pkexec' | 'sudo' | null
}

export interface InstallOptions {
  pkg: string
  parkDir: string
  stopApache: boolean
  dnsMode: DnsMode
}

/** Programas que el panel sabe comparar y, a veces, actualizar. */
export type UpdateId = 'php' | 'nginx' | 'dnsmasq' | 'composer' | 'valet' | 'node'

export interface UpdateItem {
  id: UpdateId
  label: string
  /** Versión instalada; vacía si el programa no está. */
  current: string
  /** Última versión conocida; vacía si no se pudo consultar. */
  latest: string
  /** Hay una versión más nueva que la instalada. */
  available: boolean
  /** Quién lo actualiza. `none`: el panel solo puede explicarlo. */
  source: 'system' | 'composer' | 'none'
  /** Paquetes del gestor implicados (solo `system`). */
  packages: string[]
  /** Por qué el panel no puede actualizarlo. Vacío cuando sí puede. */
  blocked: string
  /** La actualización pedirá la contraseña de administrador. */
  needsElevation: boolean
  /** Qué ejecutar a mano cuando el panel no puede. */
  commands: string[]
}

export interface UpdatesInfo {
  items: UpdateItem[]
  /** Epoch en milisegundos de la última comprobación. */
  checkedAt: number
  /** Motivo parcial: por ejemplo, no se pudo consultar internet. */
  warning: string
}
export type StepStatus = 'wait' | 'run' | 'ok' | 'skip' | 'fail'
export type InstallEvent =
  | { type: 'plan'; steps: { id: string; label: string }[] }
  | { type: 'step'; id: string; status: StepStatus }
  | { type: 'log'; text: string }
  | { type: 'error'; title: string; detail: string; hint: string; commands: string[] }
