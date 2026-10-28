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
    setNotice(`.env actualizado: ${r.changed.join(', ') || 'sin cambios'}${r.backup ? ` · copia en ${r.backup}` : ''}`)
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
        <h1 id="mp-int-title">Integraciones de correo</h1>
        <button className="btn ghost" onClick={onClose} disabled={busy}><Glyph name="close" size={13} />Cerrar</button>
      </header>

      {error && <div className="error" role="alert"><Glyph name="alert" size={15} /><span>{error}</span></div>}
      {notice && <div className="mp-note"><Glyph name="check" size={14} />{notice}</div>}

      <div className="mp-dialog-body">
        <section className="mp-section">
          <h3>Laravel · .env</h3>
          <p className="mp-hint">
            Escribe <code>MAIL_MAILER</code>, <code>MAIL_HOST</code>, <code>MAIL_PORT</code> y las credenciales
            en el <code>.env</code> del sitio. Se guarda una copia antes de cambiar nada.
          </p>
          <div className="mp-inline">
            <label className="mp-field">
              <span>Sitio</span>
              <select value={site} onChange={(e) => setSite(e.target.value)}>
                {sites.length === 0 && <option value="">No hay sitios registrados</option>}
                {sites.map((s) => <option key={s.name} value={s.name}>{s.name} · {s.path}</option>)}
              </select>
            </label>
            <button className="btn tonal" disabled={busy || !site} onClick={configure}>
              <Glyph name="check" size={12} />Configurar .env
            </button>
          </div>
          <p className="mp-hint">SMTP: <code>{info.smtpAddr}</code> · cifrado: {info.tls ? 'TLS' : 'sin TLS'}.</p>
        </section>

        <section className="mp-section">
          <h3>PHP · sendmail_path</h3>
          <p className="mp-hint">
            Hace que <code>mail()</code> de PHP entregue en Mailpit. Se editan <code>fpm/php.ini</code> y
            <code> cli/php.ini</code> con <code>pkexec</code>, se guarda copia y se reinicia php-fpm.
          </p>
          {sendmail.length === 0 && <p className="mp-hint">No se detectaron versiones de php-fpm.</p>}
          <ul className="mp-php-list">
            {sendmail.map((s) => (
              <li key={s.version}>
                <div className="mp-php-main">
                  <strong>PHP {s.version}</strong>
                  <small>{s.fpmFile ?? 'sin fpm/php.ini'} · {s.cliFile ?? 'sin cli/php.ini'}</small>
                  <code>{s.sendmailPath}</code>
                </div>
                <span className={`tag ${s.enabled ? 'on' : ''}`}>{s.enabled ? 'configurado' : 'sin configurar'}</span>
                <div className="mp-php-actions">
                  <button
                    className="btn"
                    disabled={busy || !s.installed || !info.installed}
                    onClick={() => run(() => window.api.mailpit.setPhpSendmail(s.version, !s.enabled), s.enabled ? 'Sendmail desactivado' : 'Sendmail activado')}
                  >
                    {s.enabled ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    className="btn tonal"
                    disabled={busy || !s.enabled}
                    onClick={() => run(() => window.api.mailpit.testPhpMail(s.version, to))}
                  >
                    Probar mail()
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mp-section">
          <h3>Correo de prueba</h3>
          <p className="mp-hint">Envía un mensaje con la API de Mailpit. Se usa como destinatario en la prueba de PHP.</p>
          <div className="mp-inline">
            <label className="mp-field">
              <span>Destinatario</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} />
            </label>
            <button className="btn" disabled={busy || !info.running} onClick={() => run(() => window.api.mailpit.sendTest(to), 'Correo de prueba enviado')}>
              <Glyph name="play" size={12} />Enviar con la API
            </button>
          </div>
        </section>

        <section className="mp-section">
          <div className="mp-section-head">
            <div>
              <h3>Registro</h3>
              <p className="mp-hint">Salida de <code>journalctl --user</code> o del archivo configurado.</p>
            </div>
            <button className="btn" disabled={busy} onClick={loadLogs}><Glyph name="refresh" size={12} />Cargar</button>
          </div>
          {logs && <pre className="mp-log">{logs}</pre>}
        </section>

        <section className="mp-section mp-danger">
          <h3>Mantenimiento</h3>
          <p className="mp-hint">Detiene el servicio, elimina la unidad y el binario gestionado. La configuración se conserva.</p>
          <label className="mp-toggle">
            <input type="checkbox" checked={deleting} onChange={(e) => setDeleting(e.target.checked)} />
            <span className="mp-toggle-track" aria-hidden="true"><span /></span>
            <span className="mp-toggle-text"><span>Borrar también los correos almacenados</span><small>Elimina <code>{info.database}</code>.</small></span>
          </label>
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => {
              if (!confirm('¿Desinstalar Mailpit del panel? El servicio se detendrá.')) return
              void run(async () => {
                await window.api.mailpit.uninstall(deleting)
                onClose()
              }, 'Mailpit desinstalado')
            }}
          >
            <Glyph name="close" size={12} />Desinstalar Mailpit
          </button>
        </section>
      </div>

      <footer>
        <span className="mp-footer-note">Los cambios de PHP pueden pedir la contraseña de administrador.</span>
        <button className="btn" onClick={onClose} disabled={busy}>Cerrar</button>
      </footer>
    </Modal>
  )
}
