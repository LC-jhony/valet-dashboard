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
    { label: 'systemd-resolved', ok: dns.resolvedActive, yes: 'activo', no: 'no está activo' },
    { label: 'NetworkManager', ok: dns.networkManager, yes: 'presente', no: 'no detectado' },
    { label: `Puerto ${dns.port}`, ok: dns.portFree, yes: 'libre para el DNS', no: 'ocupado por otro programa' },
    { label: `*.${domain}`, ok: dns.testResolves, yes: 'resuelve a este equipo', no: 'todavía no resuelve' }
  ]

  return (
    <div className="panel dns-panel" id="install-dns">
      <div className="panel-head">
        <span className="panel-icon"><Icon name="folder_connection_open" size={18} /></span>
        <h2 className="panel-title">Red y DNS</h2>
        <span className={`tag ${dns.dashboardActive || dns.testResolves ? 'on' : 'warn'}`}>
          {dns.dashboardActive ? 'DNS seguro activo' : dns.testResolves ? 'los sitios resuelven' : 'sin DNS propio'}
        </span>
      </div>

      <p className="dns-intro">
        Tus sitios se llaman <code>algo.{domain}</code> y no existen en internet. Para que el
        navegador los encuentre, este equipo tiene que responder por <code>*.{domain}</code>:
        eso es el DNS. Elige cómo quieres que responda; se aplica al instalar o al pulsar{' '}
        <strong>Reparar DNS</strong>.
      </p>

      <div className="dns-modes" role="radiogroup" aria-label="Modo DNS" onKeyDown={onKeyDown}>
        <button
          type="button"
          role="radio"
          aria-checked={dnsMode === 'safe'}
          ref={(el) => { refs.current.safe = el }}
          className={`dns-mode ${dnsMode === 'safe' ? 'on' : ''}`}
          disabled={Boolean(safeReason)}
          title={safeReason ? `No disponible: ${safeReason}` : undefined}
          onClick={() => onMode('safe')}
        >
          <span className="dns-mode-head">
            <span className="dns-mode-dot" aria-hidden="true" />
            <strong>Seguro</strong>
            {env.recommendedDnsMode === 'safe' && <span className="tag on">recomendado</span>}
          </span>
          <span className="dns-mode-what">
            Un dnsmasq propio escucha en <code>127.0.0.1:{dns.port}</code> y systemd-resolved le
            pasa solo lo que acaba en <code>.{domain}</code>.
          </span>
          <span className={`dns-mode-note ${safeReason ? 'warn' : ''}`}>
            {safeReason
              ? <>No disponible: {safeReason}.</>
              : <>No toca tu WiFi, ni <code>/etc/resolv.conf</code>, ni desactiva systemd-resolved.</>}
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
            {env.recommendedDnsMode === 'hosts' && <span className="tag on">recomendado</span>}
          </span>
          <span className="dns-mode-what">
            Añade una línea por sitio en <code>/etc/hosts</code>, la lista donde el sistema
            busca nombres. Sin daemon DNS:
          </span>
          <span className="dns-mode-code"><code>127.0.0.1 mi-app.{domain}</code></span>
          <span className="dns-mode-note">
            Cada sitio nuevo hay que añadirlo con <strong>Sincronizar hosts</strong>.
            Tampoco toca tu red.
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
            <strong>Clásico</strong>
          </span>
          <span className="dns-mode-what">
            Es el DNS original de Valet: reescribe <code>/etc/resolv.conf</code>, aparta
            systemd-resolved y reinicia NetworkManager.
          </span>
          <span className="dns-mode-note warn">
            Puede dejarte sin WiFi hasta reiniciar. Úsalo solo si ya lo tenías así.
          </span>
        </button>
      </div>

      {dnsMode === 'classic' && (
        <p className="panel-warn">
          El modo clásico cambia la configuración de red del sistema. Si después no navegas,
          reinicia el equipo y el panel podrá volver al modo seguro.
        </p>
      )}

      <div className="dns-checks">
        <h3>Comprobaciones en este equipo</h3>
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
          <Glyph name="restart" size={13} />Reparar DNS
        </button>
        <button
          className="btn"
          disabled={busy || !installed || dnsMode !== 'hosts'}
          title={dnsMode === 'hosts' ? 'Añade a /etc/hosts los sitios que falten' : 'Solo se usa en el modo Hosts'}
          onClick={onSync}
        >
          <Glyph name="restart" size={13} />Sincronizar hosts
        </button>
        <span className="dns-actions-note">
          {dnsMode === 'classic'
            ? 'Este modo no necesita reparación desde el panel.'
            : dnsMode === 'hosts'
              ? 'Reparar DNS vuelve a escribir /etc/hosts con todos tus sitios.'
              : 'Reparar DNS vuelve a aplicar la ruta del modo seguro.'}
        </span>
      </div>
    </div>
  )
}
