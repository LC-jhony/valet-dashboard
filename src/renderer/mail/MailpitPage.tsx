import { useCallback, useEffect, useRef, useState } from 'react'
import type { MailpitConfig, MailpitInfo } from '../../shared/mailpit'
import { MAILPIT_POP3_WARNING } from '../../shared/mailpit'
import { Glyph } from '../ui-icons'
import { errorMessage } from '../errors'
import { MailpitSettingsDialog, type MailpitSettingsTab } from './MailpitSettingsDialog'
import { MailpitIntegrationsDialog } from './MailpitIntegrationsDialog'

interface Resource<T> {
  data?: T
  error: string
  loading: boolean
  reload: () => void
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function MailpitSidebar({ r }: { r: Resource<MailpitInfo> }) {
  const info = r.data
  return (
    <>
      {r.error && <div className="side-alert" role="alert"><Glyph name="alert" size={14} /><span>{r.error}</span></div>}
      {r.loading && !info && (
        <div className="side-skeleton" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <div className="side-skeleton-row" key={i}><span className="sk-icon" /><span className="sk-lines"><span className="sk-line w1" /><span className="sk-line w2" /></span></div>
          ))}
        </div>
      )}
      {info && (
        <>
          <div className="side-current">
            <span className="side-current-icon"><Glyph name="mail" size={20} /></span>
            <div>
              <span className="side-label">Servidor de correo</span>
              <strong>Mailpit {info.version ?? ''}</strong>
              <span className="side-current-sub">{info.running ? `escuchando en ${info.ports.ui}` : 'detenido'}</span>
            </div>
            <span className={`status-dot ${info.running ? 'ok' : 'idle'}`} />
          </div>

          <div className="side-group-label">Endpoints</div>
          <ul className="side-check-list">
            <li className={info.running ? 'ok' : 'warn'}>
              <Glyph name="globe" size={15} /><span>UI/API</span>
              <code className="mp-side-code">{info.ports.ui}</code>
            </li>
            <li className={info.running ? 'ok' : 'warn'}>
              <Glyph name="mail" size={15} /><span>SMTP</span>
              <code className="mp-side-code">{info.ports.smtp}</code>
            </li>
            <li className={info.running && info.pop3Enabled ? 'ok' : 'warn'}>
              <Glyph name="mail" size={15} /><span>POP3</span>
              <code className="mp-side-code">{info.pop3Enabled ? info.ports.pop3 : 'off'}</code>
            </li>
          </ul>

          <div className="side-group-label">Buzón</div>
          <ul className="side-check-list">
            <li className={info.running ? 'ok' : 'warn'}>
              <Glyph name="info" size={15} /><span>Mensajes</span>
              <strong>{info.messages ?? '—'}</strong>
            </li>
            <li className={info.running ? 'ok' : 'warn'}>
              <Glyph name="info" size={15} /><span>Sin leer</span>
              <strong>{info.unread ?? '—'}</strong>
            </li>
            <li>
              <Glyph name="info" size={15} /><span>Base de datos</span>
              <span>{formatBytes(info.databaseSize)}</span>
            </li>
          </ul>

          <div className="side-group-label">Binario</div>
          <ul className="side-check-list">
            <li className={info.binary ? 'ok' : 'warn'}>
              <Glyph name="install" size={15} />
              <span>{info.binarySource === 'system' ? 'Mailpit del sistema' : 'Copia gestionada'}</span>
              <Glyph name={info.binary ? 'check' : 'alert'} size={13} />
            </li>
            <li className={info.latestVersion ? 'ok' : 'warn'}>
              <Glyph name="refresh" size={15} /><span>Última versión</span>
              <span>{info.latestVersion ?? '—'}</span>
            </li>
            {info.tls && <li className="ok"><Glyph name="lock" size={15} /><span>TLS activo</span><Glyph name="check" size={13} /></li>}
            {info.auth && <li className="ok"><Glyph name="lock" size={15} /><span>Auth de UI</span><Glyph name="check" size={13} /></li>}
          </ul>

          {info.warnings.length > 0 && (
            <div className="side-alert" role="alert">
              <Glyph name="alert" size={14} />
              <span>{info.warnings[0]}{info.warnings.length > 1 ? ` (+${info.warnings.length - 1})` : ''}</span>
            </div>
          )}

          {info.uptime && <p className="side-note">En marcha desde hace {info.uptime}.</p>}
          <p className="side-note">El buzón se abre en el área principal. Los atajos Ctrl+1…6 siguen funcionando dentro de Mailpit.</p>
        </>
      )}
    </>
  )
}

export function MailpitPage({ r, active, overlay }: {
  r: Resource<MailpitInfo>
  active: boolean
  overlay: boolean
}) {
  const info = r.data
  const hostRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [percent, setPercent] = useState(0)
  const [log, setLog] = useState('')
  const [config, setConfig] = useState<MailpitConfig | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<MailpitSettingsTab | undefined>(undefined)
  const [integrationsOpen, setIntegrationsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => window.api.mailpit.onEvent((ev) => {
    if (ev.type === 'status') setStatus(ev.text)
    else if (ev.type === 'progress') { setPercent(ev.percent); setStatus(ev.text) }
    else setLog((l) => (l + ev.text).slice(-40000))
  }), [])

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await fn()
      r.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }, [r.reload])

  const install = async () => {
    setBusy(true)
    setError('')
    setLog('')
    setPercent(0)
    setStatus('Consultando la última versión…')
    try {
      await window.api.mailpit.install()
      setStatus('Instalación completada')
      r.reload()
    } catch (e) {
      setError(errorMessage(e))
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const openSettings = async (tab?: MailpitSettingsTab) => {
    setBusy(true)
    setError('')
    try {
      setConfig(await window.api.mailpit.config())
      setSettingsTab(tab)
      setSettingsOpen(true)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const closeSettings = () => {
    setSettingsOpen(false)
    setSettingsTab(undefined)
  }

  // Mantiene la WebContentsView alineada con el hueco del renderer.
  useEffect(() => {
    if (!active || !info?.running) {
      window.api.mailpit.setBounds(null, false)
      return
    }
    const el = hostRef.current
    if (!el) return
    let frame = 0
    let lastKey = ''
    const send = () => {
      frame = 0
      const node = hostRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      const area = scroller?.getBoundingClientRect()
      const left = Math.max(rect.left, area?.left ?? 0)
      const top = Math.max(rect.top, area?.top ?? 0)
      const right = Math.min(rect.right, area?.right ?? window.innerWidth)
      const bottom = Math.min(rect.bottom, area?.bottom ?? window.innerHeight)
      const width = right - left
      const height = bottom - top
      if (width < 2 || height < 2) {
        if (lastKey !== 'hidden') {
          lastKey = 'hidden'
          window.api.mailpit.setBounds(null, false)
        }
        return
      }
      const visible = !(overlay || settingsOpen || integrationsOpen)
      // Solo se envía la geometría cuando cambia: evita IPC y reajustes
      // innecesarios en cada tick del temporizador.
      const key = `${Math.round(left)},${Math.round(top)},${Math.round(width)},${Math.round(height)},${visible}`
      if (key === lastKey) return
      lastKey = key
      window.api.mailpit.setBounds({ x: left, y: top, width, height }, visible)
    }
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(send) }
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    const scroller = el.closest('.editor')
    scroller?.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    const interval = window.setInterval(schedule, 1200)
    schedule()
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      ro.disconnect()
      scroller?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.clearInterval(interval)
      window.api.mailpit.setBounds(null, false)
    }
  }, [active, info?.running, info?.uiUrl, overlay, settingsOpen, integrationsOpen])

  const copyUrl = async () => {
    if (!info) return
    try {
      await navigator.clipboard.writeText(info.uiUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch { setError('No se pudo copiar la URL') }
  }

  const update = info?.binarySource === 'managed' && info.latestVersion && info.managedVersion && info.latestVersion !== info.managedVersion

  return (
    <section className="page mp-page">
      <header className="page-head">
        <div className="page-copy">
          <h1>Correo</h1>
          <p>Mailpit captura el correo de desarrollo, con la interfaz web completa, API, SMTP, POP3 y Relay.</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={r.reload} disabled={r.loading}>
            <Glyph name="refresh" size={14} className={r.loading ? 'spin' : ''} />Actualizar
          </button>
        </div>
      </header>

      {r.error && <div className="error" role="alert"><Glyph name="alert" size={15} /><span>{r.error}</span></div>}
      {error && <div className="error" role="alert"><Glyph name="alert" size={15} /><span>{error}</span></div>}

      {!info && r.loading && <div className="skeleton" aria-hidden="true"><div className="skeleton-row"><span className="sk-icon" /><span className="sk-lines"><span className="sk-line w1" /><span className="sk-line w2" /></span></div></div>}

      {info && (
        <>
          <div className="panel mp-hero">
            <div className="panel-head">
              <span className="panel-icon"><Glyph name="mail" size={18} /></span>
              <h2 className="panel-title">Mailpit</h2>
              <span className={`tag ${info.running ? 'on' : ''}`}>{info.running ? 'en ejecución' : 'detenido'}</span>
              {info.version && <span className="tag info">{info.version}</span>}
            </div>
            <div className="mp-endpoints">
              <div className="mp-endpoint">
                <span className="mp-endpoint-label"><Glyph name="globe" size={13} />Web UI y API</span>
                <code>{info.uiUrl}</code>
                <button className="icon-btn" onClick={copyUrl} title="Copiar URL" aria-label="Copiar URL">
                  <Glyph name={copied ? 'check' : 'copy'} size={13} />
                </button>
              </div>
              <div className="mp-endpoint">
                <span className="mp-endpoint-label"><Glyph name="mail" size={13} />SMTP</span>
                <code>{info.smtpAddr}</code>
              </div>
              <div className="mp-endpoint">
                <span className="mp-endpoint-label"><Glyph name="mail" size={13} />POP3</span>
                <code>{info.pop3Addr}</code>
                {!info.pop3Enabled && (
                  <button
                    className="btn ghost mp-inline-btn"
                    disabled={busy}
                    title="Activar la autenticación POP3 en la configuración"
                    onClick={() => openSettings('auth')}
                  >
                    <Glyph name="settings" size={12} />Activarlo
                  </button>
                )}
              </div>
            </div>
            <div className="panel-actions">
              {!info.installed && <button className="btn primary" disabled={busy} onClick={install}><Glyph name="install" size={13} />{busy ? 'Instalando…' : 'Instalar Mailpit'}</button>}
              {info.installed && !info.running && <button className="btn primary" disabled={busy} onClick={() => act(() => window.api.mailpit.start())}><Glyph name="play" size={13} />Iniciar</button>}
              {info.running && <button className="btn" disabled={busy} onClick={() => act(() => window.api.mailpit.stop())}><Glyph name="stop" size={13} />Detener</button>}
              {info.running && <button className="btn" disabled={busy} onClick={() => act(() => window.api.mailpit.restart())}><Glyph name="restart" size={13} />Reiniciar</button>}
              {update && <button className="btn tonal" disabled={busy} onClick={install}><Glyph name="install" size={13} />Actualizar a {info.latestVersion}</button>}
              {info.installed && <button className="btn" disabled={busy} onClick={() => act(() => window.api.mailpit.openExternal())}><Glyph name="globe" size={13} />Abrir en el navegador</button>}
              <button className="btn" disabled={busy} aria-label="Configuración de Mailpit" onClick={() => openSettings()}><Glyph name="settings" size={13} />Configuración</button>
              <button className="btn" disabled={busy || !info.installed} onClick={() => setIntegrationsOpen(true)}><Glyph name="terminal" size={13} />Integraciones</button>
              {info.running && <button className="btn danger" disabled={busy || !info.messages} onClick={() => confirm('¿Vaciar todos los mensajes del buzón?') && act(() => window.api.mailpit.clearMessages())}><Glyph name="close" size={13} />Vaciar buzón</button>}
              {/* No depende de que falte el binario: si ya instalaste la copia
                  gestionada, este botón es la forma de volver al del sistema. */}
              {info.systemBinary && info.binarySource !== 'system' && <button className="btn" disabled={busy} onClick={() => act(() => window.api.mailpit.useSystem(info.systemBinary as string))}><Glyph name="check" size={13} />Usar el del sistema</button>}
            </div>
          </div>

          <div className="mp-stats">
            <div className="mp-stat"><span>Mensajes</span><strong>{info.messages ?? '—'}</strong><small>{info.unread ?? 0} sin leer</small></div>
            <div className="mp-stat"><span>Base de datos</span><strong>{formatBytes(info.databaseSize)}</strong><small>{info.database}</small></div>
            <div className="mp-stat"><span>Uptime</span><strong>{info.uptime ?? '—'}</strong><small>{info.running ? 'servicio activo' : 'servicio detenido'}</small></div>
            <div className="mp-stat"><span>Protección</span><strong>{info.auth ? 'Auth' : 'Abierto'}{info.tls ? ' · TLS' : ''}</strong><small>{info.systemdAvailable ? 'systemd --user' : 'systemd no disponible'}</small></div>
          </div>

          {busy && (status || percent > 0) && (
            <div className="mp-install">
              <div className="mp-install-head">
                <Glyph name="spinner" size={14} className="spin" />
                <span>{status || 'Trabajando…'}</span>
                {percent > 0 && <strong>{percent}%</strong>}
              </div>
              <div className="mp-progress"><span style={{ width: `${percent}%` }} /></div>
              {log && <pre className="mp-log">{log}</pre>}
            </div>
          )}

          {info.warnings.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <span className="panel-icon"><Glyph name="alert" size={18} /></span>
                <h2 className="panel-title">Avisos</h2>
              </div>
              <ul className="side-check-list">
                {info.warnings.filter((w) => w !== MAILPIT_POP3_WARNING).map((w, i) => (
                  <li key={i} className="warn"><Glyph name="alert" size={15} /><span>{w}</span></li>
                ))}
                {!info.pop3Enabled && (
                  <li className="warn mp-action-row">
                    <Glyph name="alert" size={15} />
                    <span>{MAILPIT_POP3_WARNING}</span>
                    <button className="btn ghost mp-inline-btn" disabled={busy} onClick={() => openSettings('auth')}>
                      <Glyph name="settings" size={12} />Configurar POP3
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="mp-embed-shell">
            {info.running
              ? <div className="mp-embed" ref={hostRef} aria-label="Interfaz de Mailpit" />
              : (
                <div className="mp-embed-empty">
                  <Glyph name="mail" size={28} />
                  <strong>{info.installed ? 'Mailpit está detenido' : 'Mailpit todavía no está instalado'}</strong>
                  <p>{info.installed
                    ? 'Inícialo para capturar correo y ver el buzón aquí mismo.'
                    : 'Instala el binario oficial para empezar a capturar el correo de desarrollo.'}</p>
                  {info.installed
                    ? <button className="btn primary" disabled={busy} onClick={() => act(() => window.api.mailpit.start())}><Glyph name="play" size={13} />Iniciar Mailpit</button>
                    : <button className="btn primary" disabled={busy} onClick={install}><Glyph name="install" size={13} />Instalar Mailpit</button>}
                </div>
              )}
          </div>
        </>
      )}

      {settingsOpen && config && info && (
        <MailpitSettingsDialog
          config={config}
          info={info}
          initialTab={settingsTab}
          onClose={closeSettings}
          onChanged={() => r.reload()}
        />
      )}
      {integrationsOpen && info && (
        <MailpitIntegrationsDialog
          info={info}
          onClose={() => setIntegrationsOpen(false)}
          onChanged={() => r.reload()}
        />
      )}
    </section>
  )
}
