import type { MailpitApi } from './mailpit'

export type { MailpitApi } from './mailpit'

export interface Site { name: string; path: string; secure: boolean; kind: 'parked' | 'linked'; url: string }
export interface ProjectInfo {
  domain: string
  parkedPaths: string[]
  defaultDir: string
  httpPort: number
  composerAvailable: boolean
  valetAvailable: boolean
}
export interface CreateProjectOptions {
  name: string
  parentDir: string
  version: string
}
export type CreateProjectEvent =
  | { type: 'stage'; label: string }
  | { type: 'log'; text: string }
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
  install: {
    check(): Promise<Env>
    start(opts: InstallOptions): Promise<void>
    uninstall(pkg: string): Promise<void>
    repairDns(mode: DnsMode): Promise<void>
    syncHosts(): Promise<void>
    onEvent(cb: (e: InstallEvent) => void): () => void
  }
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
}

export interface InstallOptions {
  pkg: string
  parkDir: string
  stopApache: boolean
  dnsMode: DnsMode
}
export type StepStatus = 'wait' | 'run' | 'ok' | 'skip' | 'fail'
export type InstallEvent =
  | { type: 'plan'; steps: { id: string; label: string }[] }
  | { type: 'step'; id: string; status: StepStatus }
  | { type: 'log'; text: string }
