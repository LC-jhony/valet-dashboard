import { useEffect, useState } from 'react'
import type { MailpitInfo, MailpitSendmailInfo } from '../../shared/mailpit'
import type { Site as ValetSite } from '../../shared/types'
import { Glyph } from '../ui-icons'
import { Modal } from '../Modal'
import { errorMessage } from '../errors'

export function MailpitIntegrationsDialog({ info, onClose, onChanged }: {
  info: MailpitInfo
  onClose: () => void
  onChanged: () => void
}) {
  const [sites, setSites] = useState<ValetSite[]>([])
  const [site, setSite] = useState('')
  const [sendmail, setSendmail] = useState<MailpitSendmailInfo[]>([])
  const [to, setTo] = useState('dev@localhost.test')
  const [logs, setLogs] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    const [s, m] = await Promise.all([
      window.api.sites.list().catch(() => [] as ValetSite[]),
      window.api.mailpit.sendmailInfo().catch(() => [] as MailpitSendmailInfo[])
    ])
    // Una respuesta vacía no debe tumbar la pestaña: el diálogo se abre
    // igual y muestra que no hay sitios o envíos que configurar.
    setSites(s ?? [])
    setSite((current) => current || s?.[0]?.name || '')
    setSendmail(m ?? [])
  }

  useEffect(() => { void load() }, [])

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
      if (ok) setNotice(ok)
      onChanged()
      await load()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const configure = () => run(async () => {
    const r = await window.api.mailpit.configureEnv(site)
    setNotice(`.env updated: ${r.changed.join(', ') || 'no changes'}${r.backup ? ` · backup at ${r.backup}` : ''}`)
  })

  const loadLogs = async () => {
    setBusy(true)
    setError('')
    try { setLogs(await window.api.mailpit.logs(250)) } catch (e) { setError(errorMessage(e)) }
    finally { setBusy(false) }
  }

  return (
    <Modal labelledBy="mp-int-title" onClose={onClose} busy={busy} className="mp-dialog mp-dialog-sm">
      <header className="page-head">
        <h1 id="mp-int-title">Mail integrations</h1>
        <button className="btn ghost" onClick={onClose} disabled={busy}><Glyph name="close" size={13} />Close</button>
      </header>

      {error && <div className="error" role="alert"><Glyph name="alert" size={15} /><span>{error}</span></div>}
      {notice && <div className="mp-note"><Glyph name="check" size={14} />{notice}</div>}

      <div className="mp-dialog-body">
        <section className="mp-section">
          <h3>Laravel · .env</h3>
          <p className="mp-hint">
            Writes <code>MAIL_MAILER</code>, <code>MAIL_HOST</code>, <code>MAIL_PORT</code> and the credentials
            into the site's <code>.env</code>. A copy is saved before anything changes.
          </p>
          <div className="mp-inline">
            <label className="mp-field">
              <span>Site</span>
              <select value={site} onChange={(e) => setSite(e.target.value)}>
                {sites.length === 0 && <option value="">No registered sites</option>}
                {sites.map((s) => <option key={s.name} value={s.name}>{s.name} · {s.path}</option>)}
              </select>
            </label>
            <button className="btn tonal" disabled={busy || !site} onClick={configure}>
              <Glyph name="check" size={12} />Configure .env
            </button>
          </div>
          <p className="mp-hint">SMTP: <code>{info.smtpAddr}</code> · encryption: {info.tls ? 'TLS' : 'none'}.</p>
        </section>

        <section className="mp-section">
          <h3>PHP · sendmail_path</h3>
          <p className="mp-hint">
            Makes PHP's <code>mail()</code> deliver to Mailpit. <code>fpm/php.ini</code> and
            <code> cli/php.ini</code> are edited with <code>pkexec</code>, a copy is saved and php-fpm is restarted.
          </p>
          {sendmail.length === 0 && <p className="mp-hint">No php-fpm versions were detected.</p>}
          <ul className="mp-php-list">
            {sendmail.map((s) => (
              <li key={s.version}>
                <div className="mp-php-main">
                  <strong>PHP {s.version}</strong>
                  <small>{s.fpmFile ?? 'no fpm/php.ini'} · {s.cliFile ?? 'no cli/php.ini'}</small>
                  <code>{s.sendmailPath}</code>
                </div>
                <span className={`tag ${s.enabled ? 'on' : ''}`}>{s.enabled ? 'configured' : 'not configured'}</span>
                <div className="mp-php-actions">
                  <button
                    className="btn"
                    disabled={busy || !s.installed || !info.installed}
                    onClick={() => run(() => window.api.mailpit.setPhpSendmail(s.version, !s.enabled), s.enabled ? 'Sendmail disabled' : 'Sendmail enabled')}
                  >
                    {s.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    className="btn tonal"
                    disabled={busy || !s.enabled}
                    onClick={() => run(() => window.api.mailpit.testPhpMail(s.version, to))}
                  >
                    Test mail()
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mp-section">
          <h3>Test mail</h3>
          <p className="mp-hint">Sends a message through the Mailpit API. It is used as the recipient in the PHP test.</p>
          <div className="mp-inline">
            <label className="mp-field">
              <span>Recipient</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} />
            </label>
            <button className="btn" disabled={busy || !info.running} onClick={() => run(() => window.api.mailpit.sendTest(to), 'Test mail sent')}>
              <Glyph name="play" size={12} />Send with the API
            </button>
          </div>
        </section>

        <section className="mp-section">
          <div className="mp-section-head">
            <div>
              <h3>Log</h3>
              <p className="mp-hint">Output from <code>journalctl --user</code> or the configured file.</p>
            </div>
            <button className="btn" disabled={busy} onClick={loadLogs}><Glyph name="refresh" size={12} />Load</button>
          </div>
          {logs && <pre className="mp-log">{logs}</pre>}
        </section>

        <section className="mp-section mp-danger">
          <h3>Maintenance</h3>
          <p className="mp-hint">Stops the service, removes the unit and the managed binary. The configuration is kept.</p>
          <label className="mp-toggle">
            <input type="checkbox" checked={deleting} onChange={(e) => setDeleting(e.target.checked)} />
            <span className="mp-toggle-track" aria-hidden="true"><span /></span>
            <span className="mp-toggle-text"><span>Also delete stored mail</span><small>Elimina <code>{info.database}</code>.</small></span>
          </label>
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => {
              if (!confirm('Uninstall the panel\'s Mailpit? The service will stop.')) return
              void run(async () => {
                await window.api.mailpit.uninstall(deleting)
                onClose()
              }, 'Mailpit uninstalled')
            }}
          >
            <Glyph name="close" size={12} />Uninstall Mailpit
          </button>
        </section>
      </div>

      <footer>
        <span className="mp-footer-note">PHP changes may ask for the administrator password.</span>
        <button className="btn" onClick={onClose} disabled={busy}>Close</button>
      </footer>
    </Modal>
  )
}
