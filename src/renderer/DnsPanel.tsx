import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { DnsMode, Env } from '../shared/types'
import { Icon } from './icons'
import { Glyph } from './ui-icons'

const ORDER: DnsMode[] = ['safe', 'hosts', 'classic']

/**
 * El DNS es la parte que nadie entiende de Valet: un sitio `algo.test` no
 * existe en internet, así que este equipo tiene que responder por él. La
 * sección empieza diciendo eso y luego ofrece las tres formas de conseguirlo,
 * cada una con lo que toca y lo que puede romper. Se elige con teclado como
 * un grupo de opciones normal.
 */
export function DnsPanel({ env, dnsMode, onMode, installed, busy, safeReason, onRepair, onSync }: {
  env: Env
  dnsMode: DnsMode
  onMode: (mode: DnsMode) => void
  installed: boolean
  busy: boolean
  /** Por qué el modo seguro no se puede elegir; vacío cuando sí se puede. */
  safeReason: string
  onRepair: () => void
  onSync: () => void
}) {
  const dns = env.dns
  const domain = dns.domain
  const refs = useRef<Partial<Record<DnsMode, HTMLButtonElement | null>>>({})

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1
        : 0
    if (!step) return
    e.preventDefault()
    const available = ORDER.filter((id) => id !== 'safe' || !safeReason)
    const at = available.indexOf(dnsMode)
    // Si el modo elegido ya no está disponible, la flecha entra por el primero.
    const next = at < 0 ? available[0] : available[(at + step + available.length) % available.length]
    onMode(next)
    refs.current[next]?.focus()
  }

  const checks = [
    { label: 'systemd-resolved', ok: dns.resolvedActive, yes: 'active', no: 'not running' },
    { label: 'NetworkManager', ok: dns.networkManager, yes: 'present', no: 'not detected' },
    { label: `Port ${dns.port}`, ok: dns.portFree, yes: 'free for DNS', no: 'taken by another program' },
    { label: `*.${domain}`, ok: dns.testResolves, yes: 'resolves to this machine', no: 'not resolving yet' }
  ]

  return (
    <div className="panel dns-panel" id="install-dns">
      <div className="panel-head">
        <span className="panel-icon"><Icon name="folder_connection_open" size={18} /></span>
        <h2 className="panel-title">Network and DNS</h2>
        <span className={`tag ${dns.dashboardActive || dns.testResolves ? 'on' : 'warn'}`}>
          {dns.dashboardActive ? 'Safe DNS active' : dns.testResolves ? 'sites resolve' : 'no DNS of its own'}
        </span>
      </div>

      <p className="dns-intro">
        Your sites are named <code>something.{domain}</code> and do not exist on the internet. For
        the browser to find them, this machine has to answer for <code>*.{domain}</code>: that is
        DNS. Choose how it should answer; it is applied when installing or when you press{' '}
        <strong>Repair DNS</strong>.
      </p>

      <div className="dns-modes" role="radiogroup" aria-label="DNS mode" onKeyDown={onKeyDown}>
        <button
          type="button"
          role="radio"
          aria-checked={dnsMode === 'safe'}
          ref={(el) => { refs.current.safe = el }}
          className={`dns-mode ${dnsMode === 'safe' ? 'on' : ''}`}
          disabled={Boolean(safeReason)}
          title={safeReason ? `Not available: ${safeReason}` : undefined}
          onClick={() => onMode('safe')}
        >
          <span className="dns-mode-head">
            <span className="dns-mode-dot" aria-hidden="true" />
            <strong>Safe</strong>
            {env.recommendedDnsMode === 'safe' && <span className="tag on">recommended</span>}
          </span>
          <span className="dns-mode-what">
            A dedicated dnsmasq listens on <code>127.0.0.1:{dns.port}</code> and systemd-resolved
            forwards it only names ending in <code>.{domain}</code>.
          </span>
          <span className={`dns-mode-note ${safeReason ? 'warn' : ''}`}>
            {safeReason
              ? <>Not available: {safeReason}.</>
              : <>It does not touch your Wi-Fi, <code>/etc/resolv.conf</code>, or disable systemd-resolved.</>}
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={dnsMode === 'hosts'}
          ref={(el) => { refs.current.hosts = el }}
          className={`dns-mode ${dnsMode === 'hosts' ? 'on' : ''}`}
          onClick={() => onMode('hosts')}
        >
          <span className="dns-mode-head">
            <span className="dns-mode-dot" aria-hidden="true" />
            <strong>Hosts</strong>
            {env.recommendedDnsMode === 'hosts' && <span className="tag on">recommended</span>}
          </span>
          <span className="dns-mode-what">
            Adds one line per site to <code>/etc/hosts</code>, the list where the system looks up
            names. No DNS daemon:
          </span>
          <span className="dns-mode-code"><code>127.0.0.1 mi-app.{domain}</code></span>
          <span className="dns-mode-note">
            Each new site must be added with <strong>Sync hosts</strong>.
            It does not touch your network either.
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={dnsMode === 'classic'}
          ref={(el) => { refs.current.classic = el }}
          className={`dns-mode ${dnsMode === 'classic' ? 'on' : ''}`}
          onClick={() => onMode('classic')}
        >
          <span className="dns-mode-head">
            <span className="dns-mode-dot" aria-hidden="true" />
            <strong>Classic</strong>
          </span>
          <span className="dns-mode-what">
            The original Valet DNS: rewrites <code>/etc/resolv.conf</code>, moves
            systemd-resolved aside and restarts NetworkManager.
          </span>
          <span className="dns-mode-note warn">
            It can leave you without Wi-Fi until you reboot. Use it only if you already had it this way.
          </span>
        </button>
      </div>

      {dnsMode === 'classic' && (
        <p className="panel-warn">
          Classic mode changes the system network configuration. If you cannot browse afterwards,
          reboot and the panel will be able to return to safe mode.
        </p>
      )}

      <div className="dns-checks">
        <h3>Checks on this machine</h3>
        <ul>
          {checks.map((c) => (
            <li key={c.label} className={c.ok ? 'ok' : 'warn'}>
              <Glyph name={c.ok ? 'check' : 'alert'} size={13} />
              <span className="dns-check-label">{c.label}</span>
              <span className="dns-check-state">{c.ok ? c.yes : c.no}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel-actions">
        <button
          className="btn"
          disabled={busy || !installed || dnsMode === 'classic' || (dnsMode === 'safe' && Boolean(safeReason))}
          onClick={onRepair}
        >
          <Glyph name="restart" size={13} />Repair DNS
        </button>
        <button
          className="btn"
          disabled={busy || !installed || dnsMode !== 'hosts'}
          title={dnsMode === 'hosts' ? 'Adds any missing sites to /etc/hosts' : 'Only used in Hosts mode'}
          onClick={onSync}
        >
          <Glyph name="restart" size={13} />Sync hosts
        </button>
        <span className="dns-actions-note">
          {dnsMode === 'classic'
            ? 'This mode does not need repairing from the panel.'
            : dnsMode === 'hosts'
              ? 'Repair DNS rewrites /etc/hosts with all your sites.'
              : 'Repair DNS reapplies the safe mode route.'}
        </span>
      </div>
    </div>
  )
}
