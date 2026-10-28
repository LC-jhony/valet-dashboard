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
import { PrereqsPanel, CommandBlock, installBlockReason } from './PrereqsPanel'
import { DnsPanel } from './DnsPanel'
import { UpdatesPanel } from './UpdatesPanel'
import { errorMessage } from './errors'

type Tab = 'sites' | 'php' | 'ports' | 'services' | 'install' | 'mail'

interface Section {
  id: Tab
  label: string
  icon: GlyphName
  hint: string
}

const SECTIONS: Section[] = [
  { id: 'sites', label: 'Sites', icon: 'sites', hint: 'Folders served by Valet. Turn HTTPS on per site without leaving the panel.' },
  { id: 'php', label: 'PHP', icon: 'php', hint: 'Installed php-fpm versions. Switch the version in use with one click.' },
  { id: 'ports', label: 'Ports', icon: 'ports', hint: 'Valet (nginx) and Apache ports, with validation and automatic rollback.' },
  { id: 'services', label: 'Services', icon: 'services', hint: 'nginx, Apache, dnsmasq, php-fpm, MySQL/MariaDB, Redis and PostgreSQL via systemctl.' },
  { id: 'install', label: 'Installation', icon: 'install', hint: 'Install Valet with an isolated Composer, repair the network and choose how your development sites resolve.' },
  { id: 'mail', label: 'Mail', icon: 'mail', hint: 'Mailpit captures development mail: full web UI, SMTP, POP3, API and Relay.' }
]

const KNOWN: Record<number, string> = { 53: 'DNS (dnsmasq)', 80: 'HTTP', 443: 'HTTPS', 3306: 'MySQL', 5354: 'Safe DNS (Valet Dashboard)', 6379: 'Redis' }
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

const STATUS: Record<string, string> = { wait: 'pending', run: 'running', ok: 'done', skip: 'skipped', fail: 'failed' }

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
          <button className="btn" onClick={onRefresh} disabled={loading} aria-label={loading ? 'Refreshing' : 'Refresh'} title="Refresh">
            <Glyph name="refresh" size={14} className={loading ? 'spin' : ''} />
            <span className="btn-label">{loading ? 'Refreshing…' : 'Refresh'}</span>
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
    <aside className="sidebar" aria-label={`Panel for ${title}`} inert={!open}>
      <div className="side-head">
        <div className="side-title">
          <span>{title}</span>
          {badge && <span className="side-badge">{badge}</span>}
        </div>
        <div className="side-tools">
          <button className="icon-btn" onClick={onRefresh} disabled={loading} title="Refresh" aria-label="Refresh">
            <Glyph name="refresh" size={15} className={loading ? 'spin' : ''} />
          </button>
          <button className="icon-btn" onClick={onHide} title="Hide panel (Ctrl+B)" aria-label="Hide panel">
            <Glyph name="panel" size={15} />
          </button>
        </div>
      </div>
      <div className="side-scroll">{children}</div>
      <div className="side-resize" onPointerDown={onResizeStart} role="separator" aria-orientation="vertical" aria-label="Resize panel" />
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
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sites" aria-label="Search sites" spellCheck={false} />
          {query && (
            <button className="side-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <Glyph name="close" size={12} />
            </button>
          )}
        </div>
      </div>
      {r.error && <SideAlert>{r.error}</SideAlert>}
      {r.loading && !r.data && <SideSkeleton rows={6} />}
      {r.data && list.length === 0 && (
        <SideEmpty>{query ? 'No matches for your search.' : 'No sites yet. Use valet park or valet link.'}</SideEmpty>
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
          <span>{query ? `${list.length} of ${all.length}` : `${all.length} sites`}</span>
          <span>{secure} with HTTPS</span>
        </div>
      )}
      <p className="side-note">Click a site to locate it in the main area.</p>
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
              <span className="side-label">In use</span>
              <strong>PHP {r.data.current}</strong>
              <span className="side-current-sub">php-fpm</span>
            </div>
            <span className="status-dot ok" />
          </div>
          <div className="side-group-label">Installed versions</div>
          <ul className="side-list">
            {r.data.versions.map((v) => (
              <li key={v}>
                <button className={`side-item ${selected === v ? 'selected' : ''}`} onClick={() => onSelect(v)}>
                  <Icon name="php" size={16} />
                  <span className="side-item-text">
                    <span className="side-item-name">PHP {v}</span>
                    <span className="side-item-sub">php-fpm</span>
                  </span>
                  {r.data?.current === v && <span className="side-item-tag">in use</span>}
                </button>
              </li>
            ))}
          </ul>
          {r.data.versions.length === 0 && <SideEmpty>No php-fpm installation found.</SideEmpty>}
        </>
      )}
      <p className="side-note">Switching versions restarts php-fpm. The nginx configuration does not change.</p>
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
            <span className={`status-dot ${info.nginxActive ? 'ok' : 'idle'}`} title={info.nginxActive ? 'Running' : 'Stopped'} />
          </button>
          <button className="side-card" onClick={() => jump('ports-apache')}>
            <span className="side-card-icon"><Icon name="folder_server_open" size={18} /></span>
            <span className="side-card-text">
              <strong>Apache</strong>
              <small>{info.apache.installed ? (info.apache.active ? 'running' : 'stopped') : 'not installed'}</small>
            </span>
            {info.apache.installed && <span className={`status-dot ${info.apache.active ? 'ok' : 'idle'}`} title={info.apache.active ? 'Running' : 'Stopped'} />}
          </button>
          <button className="side-card" onClick={() => jump('ports-usage')}>
            <span className="side-card-icon"><Glyph name="ports" size={18} /></span>
            <span className="side-card-text">
              <strong>Port usage</strong>
              <small>{info.usage.length} listening · {conflicts} conflicts</small>
            </span>
            {conflicts > 0
              ? <span className="side-count warn">{conflicts}</span>
              : <span className="status-dot ok" title="No conflicts" />}
          </button>
          <p className="side-note">Changes are validated with <code>nginx -t</code> and rolled back if they fail.</p>
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
                  <span className="side-item-sub">{s.active ? 'running' : 'stopped'}</span>
                </span>
                <span className={`status-dot ${s.active ? 'ok' : 'idle'}`} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {r.data?.length === 0 && <SideEmpty>No recognized services.</SideEmpty>}
      {all.length > 0 && (
        <div className="side-summary">
          <span>{active} running</span>
          <span>{all.length - active} stopped</span>
        </div>
      )}
      <p className="side-note">Actions use <code>systemctl</code> and may ask for permissions.</p>
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
              <span className="side-label">System</span>
              <strong>{env.distro}</strong>
              <span className="side-current-sub">{env.pm ? `Manager: ${env.pm}` : 'No compatible manager'}</span>
            </div>
          </div>
          <div className="side-group-label">Tools</div>
          <ul className="side-check-list">
            {Object.entries(TOOLS).map(([key, tool]) => {
              // pkexec puede faltar si la elevación va por sudo.
              const ok = key === 'pkexec' ? Boolean(env.elevation) : env.tools[key]
              return (
                <li key={key} className={ok ? 'ok' : 'warn'}>
                  <Icon name={tool.icon} size={16} />
                  <span>{tool.label}</span>
                  <Glyph name={ok ? 'check' : 'alert'} size={13} />
                </li>
              )
            })}
          </ul>
          <div className="side-group-label">Network and DNS</div>
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
              <span>Port {env.dns.port} for DNS</span>
              <Glyph name={env.dns.portFree ? 'check' : 'alert'} size={13} />
            </li>
            <li className={env.dns.testResolves ? 'ok' : 'warn'}>
              <Icon name="folder_connection_open" size={16} />
              <span>*.{env.dns.domain}</span>
              <Glyph name={env.dns.testResolves ? 'check' : 'alert'} size={13} />
            </li>
          </ul>
          {env.composer.conflict && <SideAlert>{env.composer.conflictDetail} An isolated Composer will be used.</SideAlert>}
          {env.prereqs.some((p) => !p.ok && p.blocking) && (
            <SideAlert>
              {env.prereqs.filter((p) => !p.ok && p.blocking).map((p) => p.label).join(', ')}: see the prerequisites guide.
            </SideAlert>
          )}
          {env.valet.installed && !env.valet.isolated && <SideAlert>External Valet detected. The dashboard uses its own isolated Composer.</SideAlert>}
          {env.warnings.some((w) => w.includes('classic DNS')) && <SideAlert>There are leftovers from Valet classic DNS. Check the network before continuing.</SideAlert>}
          {!env.dns.resolvedActive && <SideAlert>systemd-resolved is not running. Use hosts mode to leave the network alone.</SideAlert>}
          {env.portHogs.length > 0 && (
            <SideAlert>Ports 80/443 in use: {env.portHogs.join(', ')}</SideAlert>
          )}
        </>
      )}
      <p className="side-note">The installation uses an isolated Composer and does not reinstall NetworkManager. Safe DNS does not disable systemd-resolved.</p>
    </>
  )
}

function ActivityBar({ tab, onSelect, onSettings }: {
  tab: Tab
  onSelect: (tab: Tab) => void
  onSettings: () => void
}) {
  return (
    <nav className="rail" aria-label="Activities">
      <button className="rail-brand" onClick={() => onSelect('sites')} title="Valet Dashboard" aria-label="Go to Sites">
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
        <button className="rail-btn" onClick={onSettings} aria-label="Settings (Ctrl+,)" data-tip="Settings  ·  Ctrl+,">
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
        {php && <span className="status-item" title="PHP version in use">PHP {php.current}</span>}
        {ports && (
          <span className="status-item" title="nginx status">
            <span className={`status-dot ${ports.nginxActive ? 'ok' : 'idle'}`} />nginx
          </span>
        )}
        {ports && <span className="status-item status-optional" title="HTTP/HTTPS ports">{ports.config.http}/{ports.config.https}</span>}
        {sites && <span className="status-item status-optional">{sites.length} sites</span>}
        {services && <span className="status-item status-optional">{activeServices}/{services.length} services</span>}
        {mail && (
          <span className="status-item" title={mail.running ? 'Mailpit capturing mail' : 'Mailpit stopped'}>
            <span className={`status-dot ${mail.running ? 'ok' : 'idle'}`} />Mailpit{mail.running ? ` :${mail.ports.ui}` : ''}
          </span>
        )}
        <button
          className="status-btn"
          onClick={onToggleTheme}
          title={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
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
      title="Sites"
      hint="Folders served by Valet (parked and linked). Create Laravel projects, enable HTTPS or open each site."
      error={r.error || a.error}
      loading={r.loading}
      onRefresh={r.reload}
      actions={
        <button className="btn primary" onClick={onCreate}>
          <Glyph name="plus" size={14} />New project
        </button>
      }
    >
      {r.loading && !r.data && <RowsSkeleton />}
      {r.data?.length === 0 && (
        <EmptyState icon="sites" title="No sites yet">
          Create one with <strong>New project</strong> or run <code>valet park</code> inside your
          projects folder to serve them here.
        </EmptyState>
      )}
      {r.data && r.data.length > 0 && (
        <>
          <div className="list-bar">
            <span>{q ? `${filtered.length} of ${all.length} sites` : `${all.length} sites`}</span>
            <span>{secure} with HTTPS</span>
          </div>
          {filtered.length === 0
            ? <EmptyState icon="search" title="No matches">No sites match “{query}”.</EmptyState>
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
                        title={s.url ? `Open ${s.url} in the browser` : 'Site name cannot be opened in the browser'}
                        onClick={() => a.act(() => window.api.sites.open(s.name))}
                      >
                        <Glyph name="globe" size={13} />
                        Open
                      </button>
                      <button className="btn" disabled={a.busy} onClick={() => a.act(() => window.api.sites.secure(s.name, !s.secure))}>
                        <Glyph name={s.secure ? 'unlock' : 'lock'} size={13} />
                        {s.secure ? 'Disable HTTPS' : 'Enable HTTPS'}
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
      hint="Installed php-fpm versions. Switch them with valet use."
      error={r.error || a.error}
      loading={r.loading}
      onRefresh={r.reload}
    >
      {r.loading && !r.data && <RowsSkeleton rows={3} />}
      {r.data && (
        <>
          <div className="list-bar">
            <span>{versions.length} installed versions</span>
            <span className="tag on"><Glyph name="check" size={11} />Current: PHP {current}</span>
          </div>
          {versions.length === 0
            ? (
              <EmptyState icon="php" title="No php-fpm installation found">
                Install one, for example <code>php8.3-fpm</code>.
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
                      {current === v && <span className="tag on"><Glyph name="check" size={11} />in use</span>}
                    </div>
                    <div className="row-actions">
                      {current !== v && (
                        <button className="btn" disabled={a.busy} onClick={() => a.act(() => window.api.php.use(v))}>
                          <Glyph name="play" size={12} />Use this version
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
      title="Ports"
      hint="Change the Valet (nginx) and Apache ports without touching the rest of the network."
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
              <span className={`tag ${info.nginxActive ? 'on' : ''}`}>{info.nginxActive ? 'running' : 'stopped'}</span>
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
                <Glyph name="check" size={14} />Save and reload nginx
              </button>
            </div>
            <p className="panel-note">
              Validates the configuration with <code>nginx -t</code>, keeps copies in <code>~/.valet-dashboard/backups</code> and restores the previous one if anything fails.
              With custom ports, open your sites as <code>site.test:{http || '…'}</code>. Ports reserved for DNS/DHCP/NTP/mDNS (53, 67, 68, 123, 5353) are not allowed.
            </p>
          </div>

          <div className="panel" id="ports-apache">
            <div className="panel-head">
              <span className="panel-icon"><Icon name="folder_server_open" size={18} /></span>
              <h2 className="panel-title">Apache</h2>
              {info.apache.installed
                ? <span className={`tag ${info.apache.active ? 'on' : ''}`}>{info.apache.active ? 'running' : info.apache.enabled ? 'stopped (starts at boot)' : 'stopped'}</span>
                : <span className="tag">not installed</span>}
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
                    <Glyph name="check" size={14} />Save and reload Apache
                  </button>
                  <button className="btn" disabled={a.busy} onClick={() => a.act(async () => {
                    await window.api.services.action('apache2', info.apache.active ? 'stop' : 'start')
                    onServiceChange()
                  })}>
                    <Glyph name={info.apache.active ? 'stop' : 'play'} size={12} />
                    {info.apache.active ? 'Stop Apache' : 'Start Apache'}
                  </button>
                </div>
                <p className="panel-note">
                  If Apache holds 80/443, move it to 8080/8443 or stop it to free the Valet ports.
                  It is validated with <code>apache2ctl configtest</code> and the previous copy is restored if it fails.
                </p>
              </>
            ) : (
              <p className="panel-note">Apache was not found in <code>/etc/apache2</code>. Valet uses nginx and does not need Apache.</p>
            )}
          </div>

          <div id="ports-usage" className="usage-block">
            <div className="section-head">
              <h2>Listening ports</h2>
              <span>{info.usage.length} processes · {conflicts} conflicts</span>
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
                      <div className="row-text"><strong>:{u.port}</strong><small>{KNOWN[u.port] ?? 'Other service'}</small></div>
                    </div>
                    <div className="row-meta">
                      {mine.has(u.port) && proc === 'nginx' && <span className="tag on">Valet</span>}
                      {conflict && <span className="tag warn"><Glyph name="alert" size={11} />conflicts with Valet</span>}
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
      title="Services"
      hint="nginx, Apache, dnsmasq, php-fpm, MySQL/MariaDB, Redis and PostgreSQL via systemctl."
      error={r.error || a.error}
      loading={r.loading}
      onRefresh={r.reload}
    >
      {r.loading && !r.data && <RowsSkeleton rows={5} />}
      {r.data && (
        <>
          <div className="list-bar">
            <span>{all.length} services</span>
            <span>{active} running</span>
          </div>
          {all.length === 0
            ? <EmptyState icon="services" title="No recognized services">Check that systemd is available and Valet is installed.</EmptyState>
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
                      <div className="row-text"><strong>{s.name}</strong><small>{s.active ? 'running' : 'stopped'}</small></div>
                    </div>
                    <div className="row-meta">
                      <span className={`tag ${s.active ? 'on' : ''}`}>{s.active ? 'running' : 'stopped'}</span>
                    </div>
                    <div className="row-actions">
                      <button className="btn" disabled={a.busy} onClick={() => a.act(() => window.api.services.action(s.name, s.active ? 'stop' : 'start'))}>
                        <Glyph name={s.active ? 'stop' : 'play'} size={12} />
                        {s.active ? 'Stop' : 'Start'}
                      </button>
                      <button className="btn" disabled={a.busy || !s.active} onClick={() => a.act(() => window.api.services.action(s.name, 'restart'))}>
                        <Glyph name="restart" size={12} />Restart
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
  const [failure, setFailure] = useState<{ title: string; detail: string; hint: string; commands: string[] } | null>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const progressRef = useRef<HTMLElement>(null)
  const env = r.data
  const installed = env?.valet.installed ?? false
  // El motivo se muestra junto al modo seguro: «no disponible» sin decir por
  // qué obliga a adivinar entre tres comprobaciones.
  const safeReason = !env
    ? 'system data is missing'
    : !env.dns.resolvedActive
      ? 'systemd-resolved is not running'
      : !env.dns.resolvConfOk
        ? '/etc/resolv.conf does not point to systemd-resolved'
        : !env.dns.portFree
          ? `port ${env.dns.port} is in use`
          : ''
  const safeAvailable = Boolean(env) && !safeReason
  const portBlocked = Boolean(env && env.portHogs.length > 0 && !(stopApache && env.portHogs.every((h) => /apache/i.test(h))))
  const repairMode: 'safe' | 'hosts' = dnsMode === 'hosts' ? 'hosts' : 'safe'
  const blockReason = installBlockReason(env, { busy, portBlocked, dnsMode, safeAvailable })
  // `pkexec` puede faltar y aun así haber elevación: sudo con el diálogo de zenity.
  const toolOk = (key: string) => (key === 'pkexec' ? Boolean(env?.elevation) : Boolean(env?.tools[key]))

  useEffect(() => window.api.install.onEvent((ev) => {
    if (ev.type === 'plan') setSteps(ev.steps.map((s) => ({ ...s, status: 'wait' })))
    else if (ev.type === 'step') setSteps((p) => p.map((s) => (s.id === ev.id ? { ...s, status: ev.status } : s)))
    else if (ev.type === 'error') setFailure({ title: ev.title, detail: ev.detail, hint: ev.hint, commands: ev.commands })
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

  // Una actualización se lanza arriba y sus pasos viven al final de la página:
  // al aparecer el plan se trae el progreso a la vista.
  useEffect(() => {
    if (!visible || steps.length === 0) return
    progressRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [steps.length, visible])

  const go = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setFailure(null)
    setLog('')
    setSteps([])
    try {
      await fn()
    } catch (e) {
      const message = errorMessage(e)
      // Cancelar no es un fallo: no merece el cartel rojo.
      if (message !== 'Operation cancelled') setError(message)
    }
    setBusy(false)
    onChanged()
  }

  const start = () => {
    if (dnsMode === 'classic' &&
      !confirm('Classic mode lets Valet modify systemd-resolved, /etc/resolv.conf and NetworkManager. It can cut off Wi-Fi or DNS. Continue?')) return
    if (env?.valet.installed && !env.valet.isolated &&
      !confirm('An external Valet was detected. The installer will create an isolated Composer and replace /usr/local/bin/valet. Continue?')) return
    void go(() => window.api.install.start({ pkg, parkDir, stopApache, dnsMode }))
  }

  return (
    <Page
      title="Installation"
      hint="Install Valet with an isolated Composer, repair the network and choose how your development sites resolve. Classic mode can cut the connection; the other two leave your network alone."
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
                  <small>{env.pm ? `Package manager: ${env.pm}` : 'Distribution not supported for automatic installation'}</small>
                </div>
              </div>
            </li>
            {Object.entries(TOOLS).map(([key, tool]) => (
              <li key={key}>
                <div className="row-main">
                  <span className="row-icon"><Icon name={tool.icon} size={18} /></span>
                  <div className="row-text">
                    <strong>{tool.label}</strong>
                    <small>{tool.label === 'Valet' ? (env.valet.isolated ? 'Isolated Composer' : 'valet-linux') : key === 'pkexec' && env.elevation === 'sudo' ? 'via sudo' : 'required'}</small>
                  </div>
                </div>
                <div className="row-meta">
                  <span className={`tag ${toolOk(key) ? 'on' : 'warn'}`}>{toolOk(key) ? 'installed' : 'missing'}</span>
                  {key === 'composer' && env.composer.conflict && <span className="tag warn">global conflict</span>}
                </div>
              </li>
            ))}
            {env.portHogs.length > 0 && (
              <li className="conflict">
                <div className="row-main">
                  <span className="row-icon"><Icon name="folder_warning_open" size={18} /></span>
                  <div className="row-text"><strong>Ports 80/443 in use</strong><small>{env.portHogs.join(', ')}</small></div>
                </div>
                <div className="row-meta"><span className="tag warn"><Glyph name="alert" size={11} />possible conflict</span></div>
              </li>
            )}
          </ul>

          {env.warnings.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <span className="panel-icon"><Icon name="folder_warning_open" size={18} /></span>
                <h2 className="panel-title">System warnings</h2>
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

          <UpdatesPanel visible={visible} busy={busy} onRun={(id) => go(() => window.api.updates.run(id))} />

          <PrereqsPanel env={env} onRecheck={r.reload} />
        </>
      )}

      {failure && (
        <div className="panel" id="install-error">
          <div className="panel-head">
            <span className="panel-icon"><Icon name="folder_warning_open" size={18} /></span>
            <h2 className="panel-title">{failure.title}</h2>
          </div>
          <p className="panel-note">{failure.detail}</p>
          <p className="panel-note">{failure.hint}</p>
          {failure.commands.length > 0 && <CommandBlock commands={failure.commands} />}
        </div>
      )}

      {env && (
        <DnsPanel
          env={env}
          dnsMode={dnsMode}
          onMode={setDnsMode}
          installed={installed}
          busy={busy}
          safeReason={safeReason}
          onRepair={() => go(() => window.api.install.repairDns(repairMode))}
          onSync={() => go(() => window.api.install.syncHosts())}
        />
      )}

      <div className="panel" id="install-options">
        <div className="panel-head">
          <span className="panel-icon"><Glyph name="install" size={17} /></span>
          <h2 className="panel-title">Installation options</h2>
        </div>
        <div className="form-grid wide">
          <label>Valet package<input value={pkg} onChange={(e) => setPkg(e.target.value)} /></label>
          <label>Projects folder<input placeholder="~/Sites" value={parkDir} onChange={(e) => setParkDir(e.target.value)} /></label>
          <label className="check">
            <input type="checkbox" checked={stopApache} onChange={(e) => setStopApache(e.target.checked)} />
            Stop and disable Apache if it holds 80/443
          </label>
        </div>
        <div className="panel-actions">
          <button
            className="btn primary"
            disabled={busy || Boolean(blockReason)}
            aria-describedby={blockReason ? 'install-block-reason' : undefined}
            onClick={start}
          >
            <Glyph name="install" size={14} />{busy
              ? 'Working…'
              : installed
                ? 'Repair installation'
                : env?.pm ? 'Install Valet' : 'Continue with what is installed'}
          </button>
          {busy && (
            <button className="btn" onClick={() => void window.api.install.cancel()}>
              <Glyph name="close" size={13} />Cancel
            </button>
          )}
          <button className="btn danger" disabled={busy || !installed || !env?.valet.isolated} onClick={() => confirm('Uninstall Valet and remove its Composer package?') && go(() => window.api.install.uninstall(pkg))}>
            <Glyph name="close" size={13} />Uninstall
          </button>
        </div>
        {blockReason && (
          <p className="panel-warn" id="install-block-reason">{blockReason}</p>
        )}
        <p className="panel-note">
          It uses <code>{env?.composer.isolatedHome ?? '~/.config/valet-dashboard/composer'}</code>, not the global Composer.
          The administrator password is requested in system windows.
          Do not run <code>valet install</code> or <code>valet uninstall</code> from a terminal: the panel enables DNS protection.
          {env?.valet.installed && !env.valet.isolated && ' The detected Valet is external and is not uninstalled automatically.'}
        </p>
      </div>

      {steps.length > 0 && (
        <section id="install-progress" className="install-section" ref={progressRef}>
          <div className="section-head">
            <h2>Progress</h2>
            <span>{steps.filter((s) => s.status === 'ok').length} of {steps.length} steps</span>
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
            <h2><Glyph name="terminal" size={15} />Log</h2>
            <button className="btn ghost" onClick={() => setLog('')}>Clear</button>
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
              aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              title="Toggle panel (Ctrl+B)"
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
        {sidebarOpen && <button className="scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} tabIndex={-1} />}
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
