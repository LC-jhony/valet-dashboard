import {
  useCallback, useEffect, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode
} from 'react'
import type { DnsMode, Env, PhpInfo, PortsInfo, PortUsage, Service, Site } from '../shared/types'
import type { MailpitInfo } from '../shared/mailpit'
import { useResolvedMode, useSettings } from './theme'
import { Icon, IconProvider, type IconName } from './icons'
import { BrandLogo } from './BrandLogo'
import { Glyph, type GlyphName } from './ui-icons'
import { modalsOpen } from './Modal'
import { SettingsDialog } from './SettingsDialog'
import { CreateProjectDialog } from './CreateProjectDialog'
import { MailpitPage, MailpitSidebar } from './mail/MailpitPage'
import { errorMessage } from './errors'

type Tab = 'sites' | 'php' | 'ports' | 'services' | 'install' | 'mail'

interface Section {
  id: Tab
  label: string
  icon: GlyphName
  hint: string
}

const SECTIONS: Section[] = [
  { id: 'sites', label: 'Sitios', icon: 'sites', hint: 'Carpetas servidas por Valet. Activa HTTPS por sitio sin salir del panel.' },
  { id: 'php', label: 'PHP', icon: 'php', hint: 'Versiones de php-fpm instaladas. Cambia la versión en uso con un clic.' },
  { id: 'ports', label: 'Puertos', icon: 'ports', hint: 'Puertos de Valet (nginx) y Apache, con validación y reversión automática.' },
  { id: 'services', label: 'Servicios', icon: 'services', hint: 'nginx, Apache, dnsmasq, php-fpm, MySQL/MariaDB, Redis y PostgreSQL vía systemctl.' },
  { id: 'install', label: 'Instalación', icon: 'install', hint: 'Instala Valet con Composer aislado y DNS seguro, o repara la red. Revisa las advertencias antes de usar el modo clásico.' },
  { id: 'mail', label: 'Correo', icon: 'mail', hint: 'Mailpit captura el correo de desarrollo: interfaz web completa, SMTP, POP3, API y Relay.' }
]

const KNOWN: Record<number, string> = { 53: 'DNS (dnsmasq)', 80: 'HTTP', 443: 'HTTPS', 3306: 'MySQL', 5354: 'DNS seguro (Valet Dashboard)', 6379: 'Redis' }
const RESERVED_PORTS = new Set([53, 67, 68, 123, 5353, 5354])
const WIDTH_KEY = 'valet-dashboard:sidebar-width'
const SIDEBAR_MIN = 220
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 268

const validPort = (v: string) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535
const validWebPort = (v: string) => validPort(v) && !RESERVED_PORTS.has(Number(v))

const serviceIcon = (name: string): IconName => {
  if (/nginx/i.test(name)) return 'nginx'
  if (/mysql|maria|postgres/i.test(name)) return 'database'
  if (/redis/i.test(name)) return 'folder_redis_open'
  if (/php/i.test(name)) return 'php'
  if (/apache/i.test(name)) return 'folder_server_open'
  if (/dns/i.test(name)) return 'folder_connection_open'
  return 'folder_config_open'
}

const portIcon = (u: PortUsage): IconName => {
  if (/mysql|maria|postgres/i.test(u.process) || [3306, 5432].includes(u.port)) return 'database'
  if (/redis/i.test(u.process) || u.port === 6379) return 'folder_redis_open'
  if (/php/i.test(u.process)) return 'php'
  if (/apache/i.test(u.process)) return 'folder_server_open'
  if (/nginx|valet/i.test(u.process) || [80, 443, 8080, 8443].includes(u.port)) return 'http'
  return 'folder_connection_open'
}

const TOOLS: Record<string, { label: string; icon: IconName }> = {
  php: { label: 'PHP', icon: 'php' },
  composer: { label: 'Composer', icon: 'folder_packages_open' },
  valet: { label: 'Valet', icon: 'laravel' },
  nginx: { label: 'nginx', icon: 'nginx' },
  dnsmasq: { label: 'dnsmasq', icon: 'folder_connection_open' },
  nmcli: { label: 'NetworkManager', icon: 'folder_connection_open' },
  certutil: { label: 'certutil', icon: 'folder_config_open' },
  xsel: { label: 'xsel', icon: 'folder_config_open' },
  pkexec: { label: 'pkexec', icon: 'folder_config_open' }
}

const STATUS: Record<string, string> = { wait: 'pendiente', run: 'en curso', ok: 'listo', skip: 'omitido', fail: 'falló' }

function portConflicts(info: PortsInfo) {
  const mine = new Set([info.config.http, info.config.https])
  return info.usage.filter((u) => {
    const proc = u.process === '—' && mine.has(u.port) && info.nginxActive ? 'nginx' : u.process
    return mine.has(u.port) && proc !== 'nginx'
  }).length
}

interface Resource<T> {
  data?: T
  error: string
  loading: boolean
  reload: () => void
}

function useResource<T>(loadFn: () => Promise<T>, active = true): Resource<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(active)
  const ticket = useRef(0)

  const load = useCallback(() => {
    const id = ++ticket.current
    setLoading(true)
    setError('')
    loadFn()
      .then((value) => { if (ticket.current === id) setData(value) })
      .catch((e: unknown) => { if (ticket.current === id) setError(errorMessage(e)) })
      .finally(() => { if (ticket.current === id) setLoading(false) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (active) load() }, [active, load])
  return { data, error, loading, reload: load }
}

function useAction(reload: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const act = useCallback(async (run: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await run()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
      reload()
    }
  }, [reload])
  return { busy, error, act }
}

function Page({ title, hint, error, loading, onRefresh, actions, children }: {
  title: string
  hint: string
  error: string
  loading: boolean
  onRefresh: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="page">
      <header className="page-head">
        <div className="page-copy">
          <h1>{title}</h1>
          <p>{hint}</p>
        </div>
        <div className="page-actions">
          {actions}
          <button className="btn" onClick={onRefresh} disabled={loading} aria-label={loading ? 'Actualizando' : 'Actualizar'} title="Actualizar">
            <Glyph name="refresh" size={14} className={loading ? 'spin' : ''} />
            <span className="btn-label">{loading ? 'Actualizando…' : 'Actualizar'}</span>
          </button>
        </div>
      </header>
      {error && <div className="error" role="alert"><Glyph name="alert" size={15} /><span>{error}</span></div>}
      {children}
    </section>
  )
}

function EmptyState({ icon = 'info', title, children }: { icon?: GlyphName; title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <Glyph name={icon} size={18} />
      <div><strong>{title}</strong><p>{children}</p></div>
    </div>
  )
}

function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <span className="sk-icon" />
          <span className="sk-lines"><span className="sk-line w1" /><span className="sk-line w2" /></span>
        </div>
      ))}
    </div>
  )
}

function SideSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="side-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="side-skeleton-row" key={i}>
          <span className="sk-icon" />
          <span className="sk-lines"><span className="sk-line w1" /><span className="sk-line w2" /></span>
        </div>
      ))}
    </div>
  )
}

function SideAlert({ children }: { children: ReactNode }) {
  return <div className="side-alert" role="alert"><Glyph name="alert" size={14} /><span>{children}</span></div>
}

function SideEmpty({ children }: { children: ReactNode }) {
  return <div className="side-empty"><Glyph name="info" size={16} /><span>{children}</span></div>
}

function Sidebar({ title, badge, onRefresh, loading, onHide, open, onResizeStart, children }: {
  title: string
  badge?: string
  onRefresh: () => void
  loading: boolean
  onHide: () => void
  open: boolean
  onResizeStart: (e: ReactPointerEvent<HTMLDivElement>) => void
  children: ReactNode
}) {
  return (
    <aside className="sidebar" aria-label={`Panel de ${title}`} inert={!open}>
      <div className="side-head">
        <div className="side-title">
          <span>{title}</span>
          {badge && <span className="side-badge">{badge}</span>}
        </div>
        <div className="side-tools">
          <button className="icon-btn" onClick={onRefresh} disabled={loading} title="Actualizar" aria-label="Actualizar">
            <Glyph name="refresh" size={15} className={loading ? 'spin' : ''} />
          </button>
          <button className="icon-btn" onClick={onHide} title="Ocultar panel (Ctrl+B)" aria-label="Ocultar panel">
            <Glyph name="panel" size={15} />
          </button>
        </div>
      </div>
      <div className="side-scroll">{children}</div>
      <div className="side-resize" onPointerDown={onResizeStart} role="separator" aria-orientation="vertical" aria-label="Redimensionar panel" />
    </aside>
  )
}

function SitesSidebar({ r, query, setQuery, selected, onSelect }: {
  r: Resource<Site[]>
  query: string
  setQuery: (v: string) => void
  selected: string | null
  onSelect: (name: string) => void
}) {
  const all = r.data ?? []
  const q = query.trim().toLowerCase()
  const list = q ? all.filter((s) => s.name.toLowerCase().includes(q) || s.path.toLowerCase().includes(q)) : all
  const secure = all.filter((s) => s.secure).length
  return (
    <>
      <div className="side-search">
        <div className="search-box">
          <Glyph name="search" size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar sitios" aria-label="Buscar sitios" spellCheck={false} />
          {query && (
            <button className="side-clear" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">
              <Glyph name="close" size={12} />
            </button>
          )}
        </div>
      </div>
      {r.error && <SideAlert>{r.error}</SideAlert>}
      {r.loading && !r.data && <SideSkeleton rows={6} />}
      {r.data && list.length === 0 && (
        <SideEmpty>{query ? 'Sin coincidencias para la búsqueda.' : 'No hay sitios todavía. Usa valet park o valet link.'}</SideEmpty>
      )}
      <ul className="side-list">
        {list.map((s) => (
          <li key={s.name}>
            <button className={`side-item ${selected === s.name ? 'selected' : ''}`} onClick={() => onSelect(s.name)} title={s.path}>
              <Icon name={s.kind === 'linked' ? 'folder_link_open' : 'folder_home_open'} size={17} />
              <span className="side-item-text">
                <span className="side-item-name">{s.name}</span>
                <span className="side-item-sub">{s.path}</span>
              </span>
              {s.secure && <Glyph name="lock" size={12} className="side-item-icon" />}
            </button>
          </li>
        ))}
      </ul>
      {all.length > 0 && (
        <div className="side-summary">
          <span>{query ? `${list.length} de ${all.length}` : `${all.length} sitios`}</span>
          <span>{secure} con HTTPS</span>
        </div>
      )}
      <p className="side-note">Haz clic en un sitio para localizarlo en el área principal.</p>
    </>
  )
}

function PhpSidebar({ r, selected, onSelect }: {
  r: Resource<PhpInfo>
  selected: string | null
  onSelect: (version: string) => void
}) {
  return (
    <>
      {r.error && <SideAlert>{r.error}</SideAlert>}
      {r.loading && !r.data && <SideSkeleton rows={4} />}
      {r.data && (
        <>
          <div className="side-current">
            <span className="side-current-icon"><Icon name="php" size={20} /></span>
            <div>
              <span className="side-label">En uso</span>
              <strong>PHP {r.data.current}</strong>
              <span className="side-current-sub">php-fpm</span>
            </div>
            <span className="status-dot ok" />
          </div>
          <div className="side-group-label">Versiones instaladas</div>
          <ul className="side-list">
            {r.data.versions.map((v) => (
              <li key={v}>
                <button className={`side-item ${selected === v ? 'selected' : ''}`} onClick={() => onSelect(v)}>
                  <Icon name="php" size={16} />
                  <span className="side-item-text">
                    <span className="side-item-name">PHP {v}</span>
                    <span className="side-item-sub">php-fpm</span>
                  </span>
                  {r.data?.current === v && <span className="side-item-tag">en uso</span>}
                </button>
              </li>
            ))}
          </ul>
          {r.data.versions.length === 0 && <SideEmpty>No se encontró ningún php-fpm instalado.</SideEmpty>}
        </>
      )}
      <p className="side-note">Cambiar la versión reinicia php-fpm. La configuración de nginx no cambia.</p>
    </>
  )
}

function PortsSidebar({ r, onNavigate }: { r: Resource<PortsInfo>; onNavigate: () => void }) {
  const info = r.data
  const conflicts = info ? portConflicts(info) : 0
  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    onNavigate()
  }
  return (
    <>
      {r.error && <SideAlert>{r.error}</SideAlert>}
      {r.loading && !info && <SideSkeleton rows={3} />}
      {info && (
        <>
          <button className="side-card" onClick={() => jump('ports-nginx')}>
            <span className="side-card-icon"><Icon name="nginx" size={18} /></span>
            <span className="side-card-text">
              <strong>Valet · nginx</strong>
              <small>HTTP {info.config.http} · HTTPS {info.config.https}</small>
            </span>
            <span className={`status-dot ${info.nginxActive ? 'ok' : 'idle'}`} title={info.nginxActive ? 'Activo' : 'Detenido'} />
          </button>
          <button className="side-card" onClick={() => jump('ports-apache')}>
            <span className="side-card-icon"><Icon name="folder_server_open" size={18} /></span>
            <span className="side-card-text">
              <strong>Apache</strong>
              <small>{info.apache.installed ? (info.apache.active ? 'activo' : 'detenido') : 'no instalado'}</small>
            </span>
            {info.apache.installed && <span className={`status-dot ${info.apache.active ? 'ok' : 'idle'}`} title={info.apache.active ? 'Activo' : 'Detenido'} />}
          </button>
          <button className="side-card" onClick={() => jump('ports-usage')}>
            <span className="side-card-icon"><Glyph name="ports" size={18} /></span>
            <span className="side-card-text">
              <strong>Uso de puertos</strong>
              <small>{info.usage.length} en escucha · {conflicts} conflictos</small>
            </span>
            {conflicts > 0
              ? <span className="side-count warn">{conflicts}</span>
              : <span className="status-dot ok" title="Sin conflictos" />}
          </button>
          <p className="side-note">Los cambios se validan con <code>nginx -t</code> y se revierten si fallan.</p>
        </>
      )}
    </>
  )
}

function ServicesSidebar({ r, selected, onSelect }: {
  r: Resource<Service[]>
  selected: string | null
  onSelect: (name: string) => void
}) {
  const all = r.data ?? []
  const active = all.filter((s) => s.active).length
  return (
    <>
      {r.error && <SideAlert>{r.error}</SideAlert>}
      {r.loading && !r.data && <SideSkeleton rows={6} />}
      {r.data && (
        <ul className="side-list">
          {all.map((s) => (
            <li key={s.name}>
              <button className={`side-item ${selected === s.name ? 'selected' : ''}`} onClick={() => onSelect(s.name)}>
                <Icon name={serviceIcon(s.name)} size={17} />
                <span className="side-item-text">
                  <span className="side-item-name">{s.name}</span>
                  <span className="side-item-sub">{s.active ? 'activo' : 'detenido'}</span>
                </span>
                <span className={`status-dot ${s.active ? 'ok' : 'idle'}`} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {r.data?.length === 0 && <SideEmpty>No hay servicios reconocidos.</SideEmpty>}
      {all.length > 0 && (
        <div className="side-summary">
          <span>{active} activos</span>
          <span>{all.length - active} detenidos</span>
        </div>
      )}
      <p className="side-note">Las acciones usan <code>systemctl</code> y pueden pedir permisos.</p>
    </>
  )
}

function InstallSidebar({ r }: { r: Resource<Env> }) {
  const env = r.data
  return (
    <>
      {r.error && <SideAlert>{r.error}</SideAlert>}
      {r.loading && !env && <SideSkeleton rows={6} />}
      {env && (
        <>
          <div className="side-current">
            <span className="side-current-icon"><Icon name="folder_server_open" size={20} /></span>
            <div>
              <span className="side-label">Sistema</span>
              <strong>{env.distro}</strong>
              <span className="side-current-sub">{env.pm ? `Gestor: ${env.pm}` : 'Sin gestor compatible'}</span>
            </div>
          </div>
          <div className="side-group-label">Herramientas</div>
          <ul className="side-check-list">
            {Object.entries(TOOLS).map(([key, tool]) => (
              <li key={key} className={env.tools[key] ? 'ok' : 'warn'}>
                <Icon name={tool.icon} size={16} />
                <span>{tool.label}</span>
                <Glyph name={env.tools[key] ? 'check' : 'alert'} size={13} />
              </li>
            ))}
          </ul>
          <div className="side-group-label">Red y DNS</div>
          <ul className="side-check-list">
            <li className={env.dns.networkManager ? 'ok' : 'warn'}>
              <Icon name="folder_connection_open" size={16} />
              <span>NetworkManager</span>
              <Glyph name={env.dns.networkManager ? 'check' : 'alert'} size={13} />
            </li>
            <li className={env.dns.resolvedActive ? 'ok' : 'warn'}>
              <Icon name="folder_connection_open" size={16} />
              <span>systemd-resolved</span>
              <Glyph name={env.dns.resolvedActive ? 'check' : 'alert'} size={13} />
            </li>
            <li className={env.dns.portFree ? 'ok' : 'warn'}>
              <Icon name="folder_connection_open" size={16} />
              <span>Puerto {env.dns.port} para DNS</span>
              <Glyph name={env.dns.portFree ? 'check' : 'alert'} size={13} />
            </li>
            <li className={env.dns.testResolves ? 'ok' : 'warn'}>
              <Icon name="folder_connection_open" size={16} />
              <span>*.{env.dns.domain}</span>
              <Glyph name={env.dns.testResolves ? 'check' : 'alert'} size={13} />
            </li>
          </ul>
          {env.composer.conflict && <SideAlert>{env.composer.conflictDetail} Se usará Composer aislado.</SideAlert>}
          {env.valet.installed && !env.valet.isolated && <SideAlert>Valet externo detectado. El dashboard usa su propio Composer aislado.</SideAlert>}
          {env.warnings.some((w) => w.includes('DNS clásico')) && <SideAlert>Hay restos del DNS clásico de Valet. Revisa la red antes de continuar.</SideAlert>}
          {!env.dns.resolvedActive && <SideAlert>systemd-resolved no está activo. Usa el modo hosts para no tocar la red.</SideAlert>}
          {env.portHogs.length > 0 && (
            <SideAlert>Puertos 80/443 ocupados: {env.portHogs.join(', ')}</SideAlert>
          )}
        </>
      )}
      <p className="side-note">La instalación usa un Composer aislado y no reinstala NetworkManager. El DNS seguro no desactiva systemd-resolved.</p>
    </>
  )
}

function ActivityBar({ tab, onSelect, onSettings }: {
  tab: Tab
  onSelect: (tab: Tab) => void
  onSettings: () => void
}) {
  return (
    <nav className="rail" aria-label="Actividades">
      <button className="rail-brand" onClick={() => onSelect('sites')} title="Valet Dashboard" aria-label="Ir a Sitios">
        <BrandLogo size={30} />
      </button>
      <div className="rail-group">
        {SECTIONS.map((s, i) => (
          <button
            key={s.id}
            className={`rail-btn ${tab === s.id ? 'active' : ''}`}
            onClick={() => onSelect(s.id)}
            aria-current={tab === s.id ? 'page' : undefined}
            aria-label={`${s.label} (Ctrl+${i + 1})`}
            data-tip={`${s.label}  ·  Ctrl+${i + 1}`}
          >
            <Glyph name={s.icon} size={22} />
          </button>
        ))}
      </div>
      <div className="rail-bottom">
        <button className="rail-btn" onClick={onSettings} aria-label="Ajustes (Ctrl+,)" data-tip="Ajustes  ·  Ctrl+,">
          <Glyph name="settings" size={20} />
        </button>
      </div>
    </nav>
  )
}

function StatusBar({ section, sites, php, ports, services, mail, mode, onToggleTheme }: {
  section: string
  sites?: Site[]
  php?: PhpInfo
  ports?: PortsInfo
  services?: Service[]
  mail?: MailpitInfo
  mode: 'light' | 'dark'
  onToggleTheme: () => void
}) {
  const activeServices = services?.filter((s) => s.active).length
  return (
    <footer className="statusbar">
      <div className="status-group">
        <span className="status-item status-brand"><span className="status-dot accent" />Valet</span>
        <span className="status-sep" aria-hidden="true" />
        <span className="status-item">{section}</span>
      </div>
      <div className="status-group">
        {php && <span className="status-item" title="Versión de PHP en uso">PHP {php.current}</span>}
        {ports && (
          <span className="status-item" title="Estado de nginx">
            <span className={`status-dot ${ports.nginxActive ? 'ok' : 'idle'}`} />nginx
          </span>
        )}
        {ports && <span className="status-item status-optional" title="Puertos HTTP/HTTPS">{ports.config.http}/{ports.config.https}</span>}
        {sites && <span className="status-item status-optional">{sites.length} sitios</span>}
        {services && <span className="status-item status-optional">{activeServices}/{services.length} servicios</span>}
        {mail && (
          <span className="status-item" title={mail.running ? 'Mailpit capturando correo' : 'Mailpit detenido'}>
            <span className={`status-dot ${mail.running ? 'ok' : 'idle'}`} />Mailpit{mail.running ? ` :${mail.ports.ui}` : ''}
          </span>
        )}
        <button
          className="status-btn"
          onClick={onToggleTheme}
          title={mode === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          aria-label={mode === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
        >
          <Glyph name={mode === 'dark' ? 'sun' : 'moon'} size={13} />
        </button>
      </div>
    </footer>
  )
}

function Sites({ r, query, selected, onCreate }: {
  r: Resource<Site[]>
  query: string
  selected: string | null
  onCreate: () => void
}) {
  const a = useAction(r.reload)
  const refs = useRef(new Map<string, HTMLLIElement>())
  const all = r.data ?? []
  const q = query.trim().toLowerCase()
  const filtered = q ? all.filter((s) => s.name.toLowerCase().includes(q) || s.path.toLowerCase().includes(q)) : all
  const secure = all.filter((s) => s.secure).length

  useEffect(() => {
    if (!selected) return
    refs.current.get(selected)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [selected, r.data])

  return (
    <Page
      title="Sitios"
      hint="Carpetas servidas por Valet (parked y linked). Crea proyectos Laravel, activa HTTPS o abre cada sitio."
      error={r.error || a.error}
      loading={r.loading}
      onRefresh={r.reload}
      actions={
        <button className="btn primary" onClick={onCreate}>
          <Glyph name="plus" size={14} />Nuevo proyecto
        </button>
      }
    >
      {r.loading && !r.data && <RowsSkeleton />}
      {r.data?.length === 0 && (
        <EmptyState icon="sites" title="Aún no hay sitios">
          Crea uno con <strong>Nuevo proyecto</strong> o ejecuta <code>valet park</code> dentro de tu
          carpeta de proyectos para servirlos aquí.
        </EmptyState>
      )}
      {r.data && r.data.length > 0 && (
        <>
          <div className="list-bar">
            <span>{q ? `${filtered.length} de ${all.length} sitios` : `${all.length} sitios`}</span>
            <span>{secure} con HTTPS</span>
          </div>
          {filtered.length === 0
            ? <EmptyState icon="search" title="Sin coincidencias">No hay sitios que coincidan con «{query}».</EmptyState>
            : (
              <ul className="rows">
                {filtered.map((s) => (
                  <li
                    key={s.name}
                    ref={(el) => { if (el) refs.current.set(s.name, el); else refs.current.delete(s.name) }}
                    className={selected === s.name ? 'selected' : ''}
                  >
                    <div className="row-main">
                      <span className="row-icon"><Icon name={s.kind === 'linked' ? 'folder_link_open' : 'folder_home_open'} size={18} /></span>
                      <div className="row-text"><strong>{s.name}</strong><small>{s.path}</small></div>
                    </div>
                    <div className="row-meta">
                      <span className="tag">{s.kind}</span>
                      {s.secure && <span className="tag on"><Glyph name="lock" size={11} />HTTPS</span>}
                    </div>
                    <div className="row-actions">
                      <button
                        className="btn"
                        disabled={a.busy || !s.url}
                        title={s.url ? `Abrir ${s.url} en el navegador` : 'Nombre de sitio no válido para abrirlo en el navegador'}
                        onClick={() => a.act(() => window.api.sites.open(s.name))}
                      >
                        <Glyph name="globe" size={13} />
                        Abrir
                      </button>
                      <button className="btn" disabled={a.busy} onClick={() => a.act(() => window.api.sites.secure(s.name, !s.secure))}>
                        <Glyph name={s.secure ? 'unlock' : 'lock'} size={13} />
                        {s.secure ? 'Quitar HTTPS' : 'Activar HTTPS'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </>
      )}
    </Page>
  )
}

function Php({ r, selected }: { r: Resource<PhpInfo>; selected: string | null }) {
  const a = useAction(r.reload)
  const refs = useRef(new Map<string, HTMLLIElement>())
  const versions = r.data?.versions ?? []
  const current = r.data?.current

  useEffect(() => {
    if (!selected) return
    refs.current.get(selected)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [selected, r.data])

  return (
    <Page
      title="PHP"
      hint="Versiones de php-fpm instaladas. Se cambia con valet use."
      error={r.error || a.error}
      loading={r.loading}
      onRefresh={r.reload}
    >
      {r.loading && !r.data && <RowsSkeleton rows={3} />}
      {r.data && (
        <>
          <div className="list-bar">
            <span>{versions.length} versiones instaladas</span>
            <span className="tag on"><Glyph name="check" size={11} />Actual: PHP {current}</span>
          </div>
          {versions.length === 0
            ? (
              <EmptyState icon="php" title="No se encontró ningún php-fpm">
                Instala uno, por ejemplo <code>php8.3-fpm</code>.
              </EmptyState>
            )
            : (
              <ul className="rows">
                {versions.map((v) => (
                  <li
                    key={v}
                    ref={(el) => { if (el) refs.current.set(v, el); else refs.current.delete(v) }}
                    className={selected === v ? 'selected' : ''}
                  >
                    <div className="row-main">
                      <span className="row-icon"><Icon name="php" size={18} /></span>
                      <div className="row-text"><strong>PHP {v}</strong><small>php-fpm</small></div>
                    </div>
                    <div className="row-meta">
                      {current === v && <span className="tag on"><Glyph name="check" size={11} />en uso</span>}
                    </div>
                    <div className="row-actions">
                      {current !== v && (
                        <button className="btn" disabled={a.busy} onClick={() => a.act(() => window.api.php.use(v))}>
                          <Glyph name="play" size={12} />Usar esta versión
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </>
      )}
    </Page>
  )
}

function Ports({ r, onServiceChange }: { r: Resource<PortsInfo>; onServiceChange: () => void }) {
  const a = useAction(r.reload)
  const [http, setHttp] = useState('')
  const [https, setHttps] = useState('')
  const [apacheHttp, setApacheHttp] = useState('')
  const [apacheHttps, setApacheHttps] = useState('')

  useEffect(() => {
    const c = r.data?.config
    if (!c) return
    setHttp(String(c.http))
    setHttps(String(c.https))
  }, [r.data?.config.http, r.data?.config.https]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const apache = r.data?.apache
    if (!apache) return
    setApacheHttp(apache.http == null ? '' : String(apache.http))
    setApacheHttps(apache.https == null ? '' : String(apache.https))
  }, [r.data?.apache.http, r.data?.apache.https]) // eslint-disable-line react-hooks/exhaustive-deps

  const info = r.data
  const mine = new Set(info ? [info.config.http, info.config.https] : [])
  const conflicts = info ? portConflicts(info) : 0
  const valetReady = validWebPort(http) && validWebPort(https) && Number(http) !== Number(https)
  const apacheReady = validWebPort(apacheHttp) && validWebPort(apacheHttps) && Number(apacheHttp) !== Number(apacheHttps)

  return (
    <Page
      title="Puertos"
      hint="Cambia los puertos de Valet (nginx) y de Apache sin tocar el resto de la red."
      error={r.error || a.error}
      loading={r.loading}
      onRefresh={r.reload}
    >
      {r.loading && !info && <RowsSkeleton rows={3} />}
      {info && (
        <>
          <div className="panel" id="ports-nginx">
            <div className="panel-head">
              <span className="panel-icon"><Icon name="nginx" size={18} /></span>
              <h2 className="panel-title">Valet · nginx</h2>
              <span className={`tag ${info.nginxActive ? 'on' : ''}`}>{info.nginxActive ? 'activo' : 'detenido'}</span>
            </div>
            <div className="form-grid">
              <label>HTTP<input type="number" min={1} max={65535} value={http} onChange={(e) => setHttp(e.target.value)} /></label>
              <label>HTTPS<input type="number" min={1} max={65535} value={https} onChange={(e) => setHttps(e.target.value)} /></label>
              <div className="field">
                <span>Presets</span>
                <span className="presets">
                  <button type="button" className="btn" onClick={() => { setHttp('80'); setHttps('443') }}>80 / 443</button>
                  <button type="button" className="btn" onClick={() => { setHttp('8080'); setHttps('8443') }}>8080 / 8443</button>
                </span>
              </div>
            </div>
            <div className="panel-actions">
              <button className="btn primary" disabled={a.busy || !valetReady} onClick={() => a.act(() => window.api.ports.set(Number(http), Number(https)))}>
                <Glyph name="check" size={14} />Guardar y recargar nginx
              </button>
            </div>
            <p className="panel-note">
              Valida la configuración con <code>nginx -t</code>, guarda copias en <code>~/.valet-dashboard/backups</code> y restaura la anterior si algo falla.
              Con puertos personalizados, abre tus sitios como <code>sitio.test:{http || '…'}</code>. No se permiten puertos reservados a DNS/DHCP/NTP/mDNS (53, 67, 68, 123, 5353).
            </p>
          </div>

          <div className="panel" id="ports-apache">
            <div className="panel-head">
              <span className="panel-icon"><Icon name="folder_server_open" size={18} /></span>
              <h2 className="panel-title">Apache</h2>
              {info.apache.installed
                ? <span className={`tag ${info.apache.active ? 'on' : ''}`}>{info.apache.active ? 'activo' : info.apache.enabled ? 'detenido (arranca al inicio)' : 'detenido'}</span>
                : <span className="tag">no instalado</span>}
            </div>
            {info.apache.installed ? (
              <>
                <div className="form-grid">
                  <label>HTTP<input type="number" min={1} max={65535} value={apacheHttp} onChange={(e) => setApacheHttp(e.target.value)} /></label>
                  <label>HTTPS<input type="number" min={1} max={65535} value={apacheHttps} onChange={(e) => setApacheHttps(e.target.value)} /></label>
                  <div className="field">
                    <span>Presets</span>
                    <span className="presets">
                      <button type="button" className="btn" onClick={() => { setApacheHttp('8080'); setApacheHttps('8443') }}>8080 / 8443</button>
                      <button type="button" className="btn" onClick={() => { setApacheHttp('80'); setApacheHttps('443') }}>80 / 443</button>
                    </span>
                  </div>
                </div>
                <div className="panel-actions">
                  <button className="btn primary" disabled={a.busy || !apacheReady} onClick={() => a.act(() => window.api.ports.setApache(Number(apacheHttp), Number(apacheHttps)))}>
                    <Glyph name="check" size={14} />Guardar y recargar Apache
                  </button>
                  <button className="btn" disabled={a.busy} onClick={() => a.act(async () => {
                    await window.api.services.action('apache2', info.apache.active ? 'stop' : 'start')
                    onServiceChange()
                  })}>
                    <Glyph name={info.apache.active ? 'stop' : 'play'} size={12} />
                    {info.apache.active ? 'Detener Apache' : 'Iniciar Apache'}
                  </button>
                </div>
                <p className="panel-note">
                  Si Apache ocupa 80/443, muévelo a 8080/8443 o detenlo para liberar los puertos de Valet.
                  Se valida con <code>apache2ctl configtest</code> y se restaura la copia anterior si falla.
                </p>
              </>
            ) : (
              <p className="panel-note">No se encontró Apache en <code>/etc/apache2</code>. Valet usa nginx y no necesita Apache.</p>
            )}
          </div>

          <div id="ports-usage" className="usage-block">
            <div className="section-head">
              <h2>Puertos en escucha</h2>
              <span>{info.usage.length} procesos · {conflicts} conflictos</span>
            </div>
            <ul className="rows">
              {info.usage.map((u) => {
                const hiddenNginx = u.process === '—' && mine.has(u.port) && info.nginxActive
                const proc = hiddenNginx ? 'nginx' : u.process
                const conflict = mine.has(u.port) && proc !== 'nginx'
                return (
                  <li key={u.port} className={conflict ? 'conflict' : ''}>
                    <div className="row-main">
                      <span className="row-icon"><Icon name={portIcon(u)} size={18} /></span>
                      <div className="row-text"><strong>:{u.port}</strong><small>{KNOWN[u.port] ?? 'Otro servicio'}</small></div>
                    </div>
                    <div className="row-meta">
                      {mine.has(u.port) && proc === 'nginx' && <span className="tag on">Valet</span>}
                      {conflict && <span className="tag warn"><Glyph name="alert" size={11} />choca con Valet</span>}
                    </div>
                    <div className="row-actions">
                      <span className="proc">{proc}{u.pid && <small>pid {u.pid}</small>}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </Page>
  )
}

function Services({ r, selected, onChanged }: {
  r: Resource<Service[]>
  selected: string | null
  onChanged: () => void
}) {
  const a = useAction(onChanged)
  const refs = useRef(new Map<string, HTMLLIElement>())
  const all = r.data ?? []
  const active = all.filter((s) => s.active).length

  useEffect(() => {
    if (!selected) return
    refs.current.get(selected)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [selected, r.data])

  return (
    <Page
      title="Servicios"
      hint="nginx, Apache, dnsmasq, php-fpm, MySQL/MariaDB, Redis y PostgreSQL vía systemctl."
      error={r.error || a.error}
      loading={r.loading}
      onRefresh={r.reload}
    >
      {r.loading && !r.data && <RowsSkeleton rows={5} />}
      {r.data && (
        <>
          <div className="list-bar">
            <span>{all.length} servicios</span>
            <span>{active} activos</span>
          </div>
          {all.length === 0
            ? <EmptyState icon="services" title="No hay servicios reconocidos">Revisa que systemd esté disponible y que Valet esté instalado.</EmptyState>
            : (
              <ul className="rows">
                {all.map((s) => (
                  <li
                    key={s.name}
                    ref={(el) => { if (el) refs.current.set(s.name, el); else refs.current.delete(s.name) }}
                    className={selected === s.name ? 'selected' : ''}
                  >
                    <div className="row-main">
                      <span className="row-icon"><Icon name={serviceIcon(s.name)} size={18} /></span>
                      <div className="row-text"><strong>{s.name}</strong><small>{s.active ? 'en ejecución' : 'detenido'}</small></div>
                    </div>
                    <div className="row-meta">
                      <span className={`tag ${s.active ? 'on' : ''}`}>{s.active ? 'activo' : 'detenido'}</span>
                    </div>
                    <div className="row-actions">
                      <button className="btn" disabled={a.busy} onClick={() => a.act(() => window.api.services.action(s.name, s.active ? 'stop' : 'start'))}>
                        <Glyph name={s.active ? 'stop' : 'play'} size={12} />
                        {s.active ? 'Detener' : 'Iniciar'}
                      </button>
                      <button className="btn" disabled={a.busy || !s.active} onClick={() => a.act(() => window.api.services.action(s.name, 'restart'))}>
                        <Glyph name="restart" size={12} />Reiniciar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </>
      )}
    </Page>
  )
}

function Install({ r, onChanged, visible }: { r: Resource<Env>; onChanged: () => void; visible: boolean }) {
  const [pkg, setPkg] = useState('cpriego/valet-linux')
  const [parkDir, setParkDir] = useState('')
  const [stopApache, setStopApache] = useState(true)
  const [dnsMode, setDnsMode] = useState<DnsMode>('safe')
  const dnsInitialized = useRef(false)
  const [steps, setSteps] = useState<{ id: string; label: string; status: string }[]>([])
  const [log, setLog] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const logRef = useRef<HTMLPreElement>(null)
  const env = r.data
  const installed = env?.valet.installed ?? false
  const safeAvailable = Boolean(env?.dns.resolvedActive && env?.dns.portFree && env?.dns.resolvConfOk)
  const portBlocked = Boolean(env && env.portHogs.length > 0 && !(stopApache && env.portHogs.every((h) => /apache/i.test(h))))
  const repairMode: 'safe' | 'hosts' = dnsMode === 'hosts' ? 'hosts' : 'safe'

  useEffect(() => window.api.install.onEvent((ev) => {
    if (ev.type === 'plan') setSteps(ev.steps.map((s) => ({ ...s, status: 'wait' })))
    else if (ev.type === 'step') setSteps((p) => p.map((s) => (s.id === ev.id ? { ...s, status: ev.status } : s)))
    else setLog((l) => (l + ev.text).slice(-60000))
  }), [])

  useEffect(() => {
    if (dnsInitialized.current || !env?.recommendedDnsMode) return
    dnsInitialized.current = true
    setDnsMode(env.recommendedDnsMode)
  }, [env?.recommendedDnsMode])

  useEffect(() => {
    if (!visible) return
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [log, visible])

  const go = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setLog('')
    setSteps([])
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e))
    }
    setBusy(false)
    onChanged()
  }

  const start = () => {
    if (dnsMode === 'classic' &&
      !confirm('El modo clásico deja que Valet modifique systemd-resolved, /etc/resolv.conf y NetworkManager. Puede cortar el WiFi o el DNS. ¿Continuar?')) return
    if (env?.valet.installed && !env.valet.isolated &&
      !confirm('Hay un Valet externo detectado. El instalador creará un Composer aislado y reemplazará /usr/local/bin/valet. ¿Continuar?')) return
    void go(() => window.api.install.start({ pkg, parkDir, stopApache, dnsMode }))
  }

  return (
    <Page
      title="Instalación"
      hint="Instala Valet con Composer aislado y DNS seguro, o repara la red. Revisa las advertencias antes de usar el modo clásico."
      error={r.error || error}
      loading={r.loading}
      onRefresh={r.reload}
    >
      {r.loading && !env && <RowsSkeleton rows={5} />}
      {env && (
        <>
          <ul className="rows">
            <li>
              <div className="row-main">
                <span className="row-icon"><Icon name="folder_server_open" size={18} /></span>
                <div className="row-text">
                  <strong>{env.distro}</strong>
                  <small>{env.pm ? `Gestor de paquetes: ${env.pm}` : 'Distribución no soportada para la instalación automática'}</small>
                </div>
              </div>
            </li>
            {Object.entries(TOOLS).map(([key, tool]) => (
              <li key={key}>
                <div className="row-main">
                  <span className="row-icon"><Icon name={tool.icon} size={18} /></span>
                  <div className="row-text">
                    <strong>{tool.label}</strong>
                    <small>{tool.label === 'Valet' ? (env.valet.isolated ? 'Composer aislado' : 'valet-linux') : 'requerido'}</small>
                  </div>
                </div>
                <div className="row-meta">
                  <span className={`tag ${env.tools[key] ? 'on' : 'warn'}`}>{env.tools[key] ? 'instalado' : 'falta'}</span>
                  {key === 'composer' && env.composer.conflict && <span className="tag warn">conflicto global</span>}
                </div>
              </li>
            ))}
            {env.portHogs.length > 0 && (
              <li className="conflict">
                <div className="row-main">
                  <span className="row-icon"><Icon name="folder_warning_open" size={18} /></span>
                  <div className="row-text"><strong>Puertos 80/443 ocupados</strong><small>{env.portHogs.join(', ')}</small></div>
                </div>
                <div className="row-meta"><span className="tag warn"><Glyph name="alert" size={11} />posible conflicto</span></div>
              </li>
            )}
          </ul>

          {env.warnings.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <span className="panel-icon"><Icon name="folder_warning_open" size={18} /></span>
                <h2 className="panel-title">Advertencias del sistema</h2>
              </div>
              <ul className="side-check-list">
                {env.warnings.map((w, i) => (
                  <li key={i} className="warn">
                    <Icon name="folder_warning_open" size={16} />
                    <span>{w}</span>
                    <Glyph name="alert" size={13} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="panel" id="install-dns">
        <div className="panel-head">
          <span className="panel-icon"><Icon name="folder_connection_open" size={18} /></span>
          <h2 className="panel-title">Red y DNS</h2>
          <span className={`tag ${env?.dns.dashboardActive ? 'on' : ''}`}>
            {env?.dns.dashboardActive ? 'DNS seguro activo' : env?.dns.testResolves ? 'resuelve' : 'sin DNS'}
          </span>
        </div>
        <div className="form-grid wide">
          <div className="field">
            <span>Modo DNS</span>
            <span className="seg">
              <button
                type="button"
                className={dnsMode === 'safe' ? 'on' : ''}
                disabled={!safeAvailable}
                title={safeAvailable ? 'dnsmasq en 127.0.0.1:5354 + systemd-resolved' : 'Requiere systemd-resolved activo, /etc/resolv.conf apuntando al stub y el puerto 5354 libre'}
                onClick={() => setDnsMode('safe')}
              >
                Seguro
              </button>
              <button type="button" className={dnsMode === 'hosts' ? 'on' : ''} onClick={() => setDnsMode('hosts')}>
                Hosts
              </button>
              <button type="button" className={dnsMode === 'classic' ? 'on' : ''} onClick={() => setDnsMode('classic')}>
                Clásico
              </button>
            </span>
          </div>
        </div>
        <ul className="side-check-list">
          <li className={env?.dns.resolvedActive ? 'ok' : 'warn'}>
            <Icon name="folder_connection_open" size={16} />
            <span>systemd-resolved</span>
            <Glyph name={env?.dns.resolvedActive ? 'check' : 'alert'} size={13} />
          </li>
          <li className={env?.dns.networkManager ? 'ok' : 'warn'}>
            <Icon name="folder_connection_open" size={16} />
            <span>NetworkManager (sin reinstalar)</span>
            <Glyph name={env?.dns.networkManager ? 'check' : 'alert'} size={13} />
          </li>
          <li className={env?.dns.portFree ? 'ok' : 'warn'}>
            <Icon name="folder_connection_open" size={16} />
            <span>Puerto {env?.dns.port ?? 5354} para DNS</span>
            <Glyph name={env?.dns.portFree ? 'check' : 'alert'} size={13} />
          </li>
          <li className={env?.dns.testResolves ? 'ok' : 'warn'}>
            <Icon name="folder_connection_open" size={16} />
            <span>*.{env?.dns.domain ?? 'test'}</span>
            <Glyph name={env?.dns.testResolves ? 'check' : 'alert'} size={13} />
          </li>
        </ul>
        <p className="panel-note">
          <strong>Seguro</strong>: dnsmasq solo en 127.0.0.1:5354 y una ruta <code>~{env?.dns.domain ?? 'test'}</code> en systemd-resolved.
          No detiene NetworkManager, no reescribe <code>/etc/resolv.conf</code> ni desactiva systemd-resolved.
          <strong> Hosts</strong>: sin daemon DNS; sincroniza <code>/etc/hosts</code>.
          <strong> Clásico</strong>: usa el DNS de Valet; puede cortar WiFi/DNS.
        </p>
      </div>

      <div className="panel" id="install-options">
        <div className="panel-head">
          <span className="panel-icon"><Glyph name="install" size={17} /></span>
          <h2 className="panel-title">Opciones de instalación</h2>
        </div>
        <div className="form-grid wide">
          <label>Paquete de Valet<input value={pkg} onChange={(e) => setPkg(e.target.value)} /></label>
          <label>Carpeta de proyectos<input placeholder="~/Sites" value={parkDir} onChange={(e) => setParkDir(e.target.value)} /></label>
          <label className="check">
            <input type="checkbox" checked={stopApache} onChange={(e) => setStopApache(e.target.checked)} />
            Detener y deshabilitar Apache si ocupa 80/443
          </label>
        </div>
        <div className="panel-actions">
          <button
            className="btn primary"
            disabled={busy || !env?.pm || portBlocked || (dnsMode === 'safe' && !safeAvailable)}
            onClick={start}
          >
            <Glyph name="install" size={14} />{busy ? 'Trabajando…' : installed ? 'Reparar instalación' : 'Instalar Valet'}
          </button>
          <button className="btn" disabled={busy || !installed || dnsMode === 'classic' || (dnsMode === 'safe' && !safeAvailable)} onClick={() => go(() => window.api.install.repairDns(repairMode))}>
            <Glyph name="restart" size={13} />Reparar DNS
          </button>
          <button className="btn" disabled={busy || !installed || dnsMode !== 'hosts'} onClick={() => go(() => window.api.install.syncHosts())}>
            <Glyph name="restart" size={13} />Sincronizar hosts
          </button>
          <button className="btn danger" disabled={busy || !installed || !env?.valet.isolated} onClick={() => confirm('¿Desinstalar Valet y quitar su paquete de Composer?') && go(() => window.api.install.uninstall(pkg))}>
            <Glyph name="close" size={13} />Desinstalar
          </button>
        </div>
        <p className="panel-note">
          Se usa <code>{env?.composer.isolatedHome ?? '~/.config/valet-dashboard/composer'}</code>, no el Composer global.
          Se pedirá la contraseña de administrador en ventanas del sistema.
          No ejecutes <code>valet install</code> ni <code>valet uninstall</code> desde la terminal: el panel activa la protección DNS.
          {env?.valet.installed && !env.valet.isolated && ' El Valet detectado es externo y no se desinstala automáticamente.'}
        </p>
      </div>

      {steps.length > 0 && (
        <section id="install-progress" className="install-section">
          <div className="section-head">
            <h2>Progreso</h2>
            <span>{steps.filter((s) => s.status === 'ok').length} de {steps.length} pasos</span>
          </div>
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={s.id} className={`step ${s.status}`}>
                <span className="step-marker">
                  {s.status === 'ok'
                    ? <Glyph name="check" size={12} />
                    : s.status === 'fail'
                      ? <Glyph name="alert" size={12} />
                      : s.status === 'run'
                        ? <Glyph name="spinner" size={12} className="spin" />
                        : i + 1}
                </span>
                <span className="step-label">{s.label}</span>
                <span className="step-status">{STATUS[s.status]}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {log && (
        <section className="log-block">
          <div className="section-head">
            <h2><Glyph name="terminal" size={15} />Registro</h2>
            <button className="btn ghost" onClick={() => setLog('')}>Limpiar</button>
          </div>
          <pre className="log" ref={logRef}>{log}</pre>
        </section>
      )}
    </Page>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>('sites')
  const [settings, setSettings] = useSettings()
  const mode = useResolvedMode(settings.mode)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 901px)').matches)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY))
      return Number.isFinite(saved) && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : SIDEBAR_DEFAULT
    } catch {
      return SIDEBAR_DEFAULT
    }
  })
  const widthRef = useRef(sidebarWidth)
  const [siteQuery, setSiteQuery] = useState('')
  const [selectedSite, setSelectedSite] = useState<string | null>(null)
  const [selectedPhp, setSelectedPhp] = useState<string | null>(null)
  const [selectedService, setSelectedService] = useState<string | null>(null)

  const sites = useResource(() => window.api.sites.list())
  const php = useResource(() => window.api.php.list())
  const ports = useResource(() => window.api.ports.scan(), tab === 'ports')
  const services = useResource(() => window.api.services.list(), tab === 'services')
  const env = useResource(() => window.api.install.check(), tab === 'install')
  const mail = useResource(() => window.api.mailpit.info())
  const previousTab = useRef(tab)

  useEffect(() => {
    if (previousTab.current === tab) return
    previousTab.current = tab
    if (tab === 'sites') sites.reload()
    else if (tab === 'php') php.reload()
    else if (tab === 'mail') mail.reload()
  }, [tab, sites.reload, php.reload, mail.reload])

  const section = SECTIONS.find((s) => s.id === tab) ?? SECTIONS[0]
  const badge = tab === 'sites' && sites.data
    ? String(sites.data.length)
    : tab === 'php' && php.data
      ? php.data.current
      : tab === 'ports' && ports.data
        ? `${ports.data.config.http}/${ports.data.config.https}`
        : tab === 'services' && services.data
          ? `${services.data.filter((s) => s.active).length}/${services.data.length}`
          : tab === 'mail' && mail.data
            ? (mail.data.running ? String(mail.data.messages ?? 0) : 'off')
            : undefined
  const loading = tab === 'sites' ? sites.loading : tab === 'php' ? php.loading : tab === 'ports' ? ports.loading : tab === 'services' ? services.loading : tab === 'mail' ? mail.loading : env.loading
  const reload = tab === 'sites' ? sites.reload : tab === 'php' ? php.reload : tab === 'ports' ? ports.reload : tab === 'services' ? services.reload : tab === 'mail' ? mail.reload : env.reload

  const refreshAll = useCallback(() => {
    sites.reload()
    php.reload()
    ports.reload()
    services.reload()
    env.reload()
    mail.reload()
  }, [sites.reload, php.reload, ports.reload, services.reload, env.reload, mail.reload])

  const refreshServicesAndPorts = useCallback(() => {
    if (services.data) services.reload()
    if (ports.data) ports.reload()
  }, [services.data, services.reload, ports.data, ports.reload])

  const closeOnMobile = () => {
    if (window.matchMedia('(max-width: 900px)').matches) setSidebarOpen(false)
  }

  const pickSite = (name: string) => {
    setSelectedSite(name)
    closeOnMobile()
  }

  const pickPhp = (version: string) => {
    setSelectedPhp(version)
    closeOnMobile()
  }

  const pickService = (name: string) => {
    setSelectedService(name)
    closeOnMobile()
  }

  const selectTab = (id: Tab) => {
    if (id === tab) {
      setSidebarOpen((v) => !v)
      return
    }
    setTab(id)
    setSidebarOpen(true)
  }

  const toggleTheme = () => setSettings({ mode: mode === 'dark' ? 'light' : 'dark' })

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia('(max-width: 900px)').matches) return
    e.preventDefault()
    const startX = e.clientX
    const startW = widthRef.current
    document.body.classList.add('resizing')
    const move = (ev: PointerEvent) => {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(startW + ev.clientX - startX)))
      widthRef.current = next
      setSidebarWidth(next)
    }
    const stop = () => {
      document.body.classList.remove('resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      try { localStorage.setItem(WIDTH_KEY, String(widthRef.current)) } catch { /* sin almacenamiento */ }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)')
    const onChange = (e: MediaQueryListEvent) => setSidebarOpen(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cualquier diálogo abierto (incluidos los de correo) se queda con el
      // teclado: si no, Ctrl+B o Ctrl+1 cambiaban la vista por detrás.
      if (settingsOpen || createOpen || modalsOpen()) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSidebarOpen((v) => !v)
        return
      }
      if (mod && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
        return
      }
      if (mod && /^[1-9]$/.test(e.key)) {
        const index = Number(e.key) - 1
        if (SECTIONS[index]) {
          e.preventDefault()
          setTab(SECTIONS[index].id)
        }
        return
      }
      if (e.key === 'Escape' && window.matchMedia('(max-width: 900px)').matches) setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, createOpen])

  useEffect(() => window.api.mailpit.onShortcut((key) => {
    const blocked = settingsOpen || createOpen || modalsOpen()
    if (blocked) return
    if (key === ',') { setSettingsOpen(true); return }
    if (key === 'b') { setSidebarOpen((v) => !v); return }
    const index = Number(key) - 1
    if (Number.isInteger(index) && SECTIONS[index]) setTab(SECTIONS[index].id)
  }), [settingsOpen, createOpen])

  return (
    <IconProvider theme={settings.iconTheme} mode={mode}>
      <div
        className={`shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}
        style={{ '--sidebar-w': `${sidebarWidth}px` } as CSSProperties}
      >
        <ActivityBar tab={tab} onSelect={selectTab} onSettings={() => setSettingsOpen(true)} />
        <Sidebar
          title={section.label}
          badge={badge}
          onRefresh={reload}
          loading={loading}
          onHide={() => setSidebarOpen(false)}
          open={sidebarOpen}
          onResizeStart={startResize}
        >
          {tab === 'sites' && <SitesSidebar r={sites} query={siteQuery} setQuery={setSiteQuery} selected={selectedSite} onSelect={pickSite} />}
          {tab === 'php' && <PhpSidebar r={php} selected={selectedPhp} onSelect={pickPhp} />}
          {tab === 'ports' && <PortsSidebar r={ports} onNavigate={closeOnMobile} />}
          {tab === 'services' && <ServicesSidebar r={services} selected={selectedService} onSelect={pickService} />}
          {tab === 'install' && <InstallSidebar r={env} />}
          {tab === 'mail' && <MailpitSidebar r={mail} />}
        </Sidebar>
        <div className="workarea">
          <header className="editorbar">
            <button
              className="icon-btn"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-pressed={sidebarOpen}
              aria-label={sidebarOpen ? 'Ocultar panel lateral' : 'Mostrar panel lateral'}
              title="Alternar panel (Ctrl+B)"
            >
              <Glyph name="panel" size={17} />
            </button>
            <div className="crumbs">
              <span className="crumb-root">Valet</span>
              <Glyph name="chevron" size={11} className="crumb-sep" />
              <span className="crumb-current"><Glyph name={section.icon} size={14} />{section.label}</span>
            </div>
            <span className="kbd-hint" aria-hidden="true"><kbd>Ctrl</kbd><kbd>B</kbd></span>
          </header>
          <main className="editor">
            {tab === 'sites' && <Sites r={sites} query={siteQuery} selected={selectedSite} onCreate={() => setCreateOpen(true)} />}
            {tab === 'php' && <Php r={php} selected={selectedPhp} />}
            {tab === 'ports' && <Ports r={ports} onServiceChange={refreshServicesAndPorts} />}
            {tab === 'services' && <Services r={services} selected={selectedService} onChanged={refreshServicesAndPorts} />}
            <div hidden={tab !== 'install'}>
              <Install r={env} onChanged={refreshAll} visible={tab === 'install'} />
            </div>
            {tab === 'mail' && <MailpitPage r={mail} active={tab === 'mail'} overlay={settingsOpen || createOpen} />}
          </main>
        </div>
        <StatusBar
          section={section.label}
          sites={sites.data}
          php={php.data}
          ports={ports.data}
          services={services.data}
          mail={mail.data}
          mode={mode}
          onToggleTheme={toggleTheme}
        />
        {sidebarOpen && <button className="scrim" aria-label="Cerrar panel lateral" onClick={() => setSidebarOpen(false)} tabIndex={-1} />}
        {settingsOpen && <SettingsDialog s={settings} set={setSettings} onClose={() => setSettingsOpen(false)} />}
        {createOpen && (
          <CreateProjectDialog
            onClose={() => setCreateOpen(false)}
            onCreated={(site) => {
              setSelectedSite(site.name)
              setTab('sites')
              sites.reload()
            }}
          />
        )}
      </div>
    </IconProvider>
  )
}
