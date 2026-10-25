export interface Site { name: string; path: string; secure: boolean; kind: 'parked' | 'linked' }
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

export interface Api {
  sites: { list(): Promise<Site[]>; secure(name: string, on: boolean): Promise<void> }
  php: { list(): Promise<PhpInfo>; use(version: string): Promise<void> }
  ports: {
    scan(): Promise<PortsInfo>
    set(http: number, https: number): Promise<void>
    setApache(http: number, https: number): Promise<void>
  }
  services: { list(): Promise<Service[]>; action(name: string, action: ServiceAction): Promise<void> }
  install: {
    check(): Promise<Env>
    start(opts: InstallOptions): Promise<void>
    uninstall(pkg: string): Promise<void>
    onEvent(cb: (e: InstallEvent) => void): () => void
  }
}

export interface Env { distro: string; pm: string | null; tools: Record<string, boolean>; portHogs: string[] }
export interface InstallOptions { pkg: string; parkDir: string; stopApache: boolean }
export type StepStatus = 'wait' | 'run' | 'ok' | 'skip' | 'fail'
export type InstallEvent =
  | { type: 'plan'; steps: { id: string; label: string }[] }
  | { type: 'step'; id: string; status: StepStatus }
  | { type: 'log'; text: string }
