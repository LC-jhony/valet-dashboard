import { useEffect, useMemo, useState } from 'react'
import type {
  MailpitAuxFile, MailpitAuthConfig, MailpitConfig, MailpitGroupId, MailpitInfo
} from '../../shared/mailpit'
import { MAILPIT_GROUPS, mailpitOptionEntries } from '../../shared/mailpit'
import { Glyph } from '../ui-icons'
import { errorMessage } from '../errors'
import { OptionField, fieldsFor, hasAdvanced } from './options'
import { Modal } from '../Modal'

export type MailpitSettingsTab = 'service' | 'auth' | 'tls' | MailpitGroupId | 'advanced' | 'yaml'
type Tab = MailpitSettingsTab

const TABS: { id: Tab; label: string }[] = [
  { id: 'service', label: 'Servicio' },
  ...MAILPIT_GROUPS.map((g) => ({ id: g.id as Tab, label: g.label })),
  { id: 'auth', label: 'Autenticación' },
  { id: 'tls', label: 'TLS' },
  { id: 'yaml', label: 'YAML' },
  { id: 'advanced', label: 'Avanzado' }
]

const AUTH_ROWS = [
  ['ui', 'Web UI y API', 'Protege el buzón y la API con Basic Auth.'],
  ['smtp', 'SMTP', 'Exige usuario y contraseña a los clientes SMTP.'],
  ['pop3', 'POP3', 'Protege el servidor POP3.'],
  ['sendApi', 'Send API', 'Credenciales separadas solo para /api/v1/send.']
] as const

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function parseAdvanced(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const idx = trimmed.indexOf('=')
    if (idx < 1) throw new Error(`Línea ${i + 1}: usa el formato MP_CLAVE=valor`)
    const key = trimmed.slice(0, idx).trim()
    if (!/^MP_[A-Z0-9_]+$/.test(key)) throw new Error(`Línea ${i + 1}: clave no válida «${key}»`)
    out[key] = trimmed.slice(idx + 1).trim()
  })
  return out
}

export function MailpitSettingsDialog({ config, info, onClose, onChanged, initialTab }: {
  config: MailpitConfig
  info: MailpitInfo
  onClose: () => void
  onChanged: () => void
  initialTab?: MailpitSettingsTab
}) {
  const [draft, setDraft] = useState<MailpitConfig>(() => clone(config))
  const [tab, setTab] = useState<Tab>(initialTab ?? 'service')
  const [advanced, setAdvanced] = useState(false)
  const [extra, setExtra] = useState(() => mailpitOptionEntries(config.options).map((e) => `${e.key}=${e.value}`).join('\n'))
  const [aux, setAux] = useState<MailpitAuxFile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let alive = true
    window.api.mailpit.auxiliary()
      .then((v) => { if (alive) setAux(v) })
      .catch((e: unknown) => { if (alive) setError(errorMessage(e)) })
    return () => { alive = false }
  }, [])

  const setOption = (key: string, value: string) => setDraft((d) => ({ ...d, options: { ...d.options, [key]: value } }))
  const setAuth = (kind: keyof MailpitConfig['auth'], patch: Partial<MailpitAuthConfig>) =>
    setDraft((d) => ({ ...d, auth: { ...d.auth, [kind]: { ...d.auth[kind], ...patch } } }))
  const setTls = (patch: Partial<MailpitConfig['tls']>) =>
    setDraft((d) => ({ ...d, tls: { ...d.tls, ...patch } }))

  const group = useMemo(() => MAILPIT_GROUPS.find((g) => g.id === tab), [tab])

  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const extras = parseAdvanced(extra)
      const options = { ...draft.options }
      const custom = new Set(mailpitOptionEntries(draft.options).map((e) => e.key))
      for (const key of custom) if (!(key in extras)) delete options[key]
      for (const [k, v] of Object.entries(extras)) {
        if (v === '') delete options[k]
        else options[k] = v
      }
      await window.api.mailpit.save({ ...draft, options })
      onChanged()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const saveAux = async (kind: MailpitAuxFile['kind'], content: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setAux(await window.api.mailpit.writeAuxiliary(kind, content))
      setNotice('Archivo YAML guardado y Mailpit reiniciado.')
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal labelledBy="mp-title" onClose={onClose} busy={busy} className="mp-dialog">
      <header className="page-head">
        <h1 id="mp-title">Configuración de Mailpit</h1>
        <button className="btn ghost" onClick={onClose} disabled={busy} aria-label="Cerrar configuración">
          <Glyph name="close" size={13} />Cerrar
        </button>
      </header>

      <div className="mp-tabs" role="tablist" aria-label="Secciones de configuración">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            data-tab={t.id}
            aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => { setTab(t.id); setAdvanced(false) }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="error" role="alert"><Glyph name="alert" size={15} /><span>{error}</span></div>}
      {notice && <div className="mp-note"><Glyph name="check" size={14} />{notice}</div>}

      <div className="mp-dialog-body">
        {tab === 'service' && (
          <section className="mp-section">
            <h3>Ejecución</h3>
            <p className="mp-hint">Mailpit se ejecuta como servicio de usuario systemd y sigue capturando correo al cerrar el panel.</p>
            <div className="mp-grid">
              <label className="mp-field">
                <span>Binario</span>
                <select
                  value={draft.binarySource}
                  onChange={(e) => setDraft((d) => ({ ...d, binarySource: e.target.value === 'system' ? 'system' : 'managed' }))}
                >
                  <option value="managed">Copia gestionada del panel</option>
                  <option value="system">Mailpit del sistema</option>
                </select>
                <small>{info.binary ? `En uso: ${info.binary}` : 'Todavía no hay ningún binario'}</small>
              </label>
              {draft.binarySource === 'system' && (
                <label className="mp-field">
                  <span>Ruta del Mailpit del sistema</span>
                  <input
                    value={draft.systemBinary}
                    placeholder="/usr/local/bin/mailpit"
                    spellCheck={false}
                    onChange={(e) => setDraft((d) => ({ ...d, systemBinary: e.target.value }))}
                  />
                  <small>{info.systemBinary ? `Detectado: ${info.systemBinary}` : 'No se encontró mailpit en PATH'}</small>
                </label>
              )}
              <label className="mp-field">
                <span>Token de GitHub (opcional)</span>
                <input
                  type="password"
                  value={draft.githubToken}
                  autoComplete="new-password"
                  placeholder="ghp_…"
                  onChange={(e) => setDraft((d) => ({ ...d, githubToken: e.target.value }))}
                />
                <small>Evita el límite de peticiones al consultar releases.</small>
              </label>
            </div>
            <label className="mp-toggle">
              <input
                type="checkbox"
                checked={draft.startAtLogin}
                onChange={(e) => setDraft((d) => ({ ...d, startAtLogin: e.target.checked }))}
              />
              <span className="mp-toggle-track" aria-hidden="true"><span /></span>
              <span className="mp-toggle-text">
                <span>Iniciar al iniciar sesión</span>
                <small>Activa la unidad con <code>systemctl --user enable</code>.</small>
              </span>
            </label>
            <div className="mp-paths">
              <span>Unidad: <code>{info.unitPath}</code></span>
              <span>Entorno: <code>{info.envPath}</code></span>
              <span>Configuración: <code>{info.configPath}</code></span>
              <span>Base de datos: <code>{info.database}</code></span>
            </div>
          </section>
        )}

        {group && (
          <section className="mp-section">
            <div className="mp-section-head">
              <div>
                <h3>{group.label}</h3>
                <p className="mp-hint">{group.hint}</p>
              </div>
              {hasAdvanced(group) && (
                <button className="btn ghost" onClick={() => setAdvanced((v) => !v)}>
                  {advanced ? 'Ocultar opciones avanzadas' : 'Mostrar opciones avanzadas'}
                </button>
              )}
            </div>
            <div className="mp-grid">
              {fieldsFor(group, advanced).map((f) => (
                <OptionField
                  key={f.key}
                  field={f}
                  value={draft.options[f.key] ?? ''}
                  onChange={(v) => setOption(f.key, v)}
                />
              ))}
            </div>
          </section>
        )}

        {tab === 'auth' && (
          <section className="mp-section">
            <h3>Autenticación</h3>
            <p className="mp-hint">
              Los archivos de contraseñas se generan en <code>~/.config/valet-dashboard/mailpit/auth</code> con permisos
              <code> 0600</code>. Si <code>htpasswd</code> está disponible se usa bcrypt; si no, se guarda texto plano.
            </p>
            <div className="mp-auth-grid">
              {AUTH_ROWS.map(([kind, label, hint]) => {
                const a = draft.auth[kind]
                return (
                  <div className={`mp-auth-card ${a.enabled ? 'on' : ''}`} key={kind}>
                    <div className="mp-auth-head">
                      <strong>{label}</strong>
                      <label className="mp-mini-toggle">
                        <input type="checkbox" checked={a.enabled} onChange={(e) => setAuth(kind, { enabled: e.target.checked })} />
                        <span>{a.enabled ? 'activa' : 'desactivada'}</span>
                      </label>
                    </div>
                    <small>{hint}</small>
                    {a.enabled && (
                      <>
                        <label className="mp-field"><span>Usuario</span>
                          <input value={a.user} spellCheck={false} autoComplete="off" onChange={(e) => setAuth(kind, { user: e.target.value })} />
                        </label>
                        <label className="mp-field"><span>Contraseña</span>
                          <input type="password" value={a.password} autoComplete="new-password" onChange={(e) => setAuth(kind, { password: e.target.value })} />
                        </label>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {tab === 'tls' && (
          <section className="mp-section">
            <h3>TLS</h3>
            <p className="mp-hint">El mismo certificado se aplica a la UI/API, SMTP y POP3. El certificado autofirmado se genera con <code>openssl</code> para localhost.</p>
            <label className="mp-toggle">
              <input type="checkbox" checked={draft.tls.enabled} onChange={(e) => setTls({ enabled: e.target.checked })} />
              <span className="mp-toggle-track" aria-hidden="true"><span /></span>
              <span className="mp-toggle-text"><span>Activar TLS</span><small>HTTPS en la UI y STARTTLS/TLS en correo.</small></span>
            </label>
            {draft.tls.enabled && (
              <>
                <label className="mp-toggle">
                  <input type="checkbox" checked={draft.tls.selfSigned} onChange={(e) => setTls({ selfSigned: e.target.checked })} />
                  <span className="mp-toggle-track" aria-hidden="true"><span /></span>
                  <span className="mp-toggle-text"><span>Certificado autofirmado</span><small>El panel acepta este certificado solo para la vista embebida.</small></span>
                </label>
                {!draft.tls.selfSigned && (
                  <div className="mp-grid">
                    <label className="mp-field"><span>Certificado</span>
                      <input value={draft.tls.cert} placeholder="/ruta/cert.pem" spellCheck={false} onChange={(e) => setTls({ cert: e.target.value })} />
                    </label>
                    <label className="mp-field"><span>Clave privada</span>
                      <input value={draft.tls.key} placeholder="/ruta/key.pem" spellCheck={false} onChange={(e) => setTls({ key: e.target.value })} />
                    </label>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {tab === 'advanced' && (
          <section className="mp-section">
            <h3>Editor avanzado</h3>
            <p className="mp-hint">
              Una opción <code>MP_CLAVE=valor</code> por línea. Sirve para variables nuevas o no cubiertas por el formulario.
              Las rutas de autenticación y TLS las gestiona el panel.
            </p>
            <textarea
              className="mp-textarea"
              rows={14}
              spellCheck={false}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={'MP_ALGUNA_OPCION=valor\nMP_OTRA=1'}
            />
            <p className="mp-hint">{mailpitOptionEntries(draft.options).length} opciones personalizadas detectadas.</p>
          </section>
        )}

        {tab === 'yaml' && (
          <section className="mp-section">
            <h3>Archivos YAML</h3>
            <p className="mp-hint">
              Relay, forward y etiquetas usan archivos YAML. Al guardar contenido no vacío se activa la opción
              correspondiente y Mailpit se reinicia; si el YAML no es válido, se revierte.
            </p>
            {aux.map((a) => (
              <div className="mp-aux" key={a.kind}>
                <div className="mp-aux-head">
                  <strong>{a.label}</strong>
                  <span className={`tag ${a.enabled ? 'on' : ''}`}>{a.enabled ? 'activo' : 'sin activar'}</span>
                  <code>{a.path}</code>
                </div>
                <textarea
                  className="mp-textarea"
                  rows={6}
                  spellCheck={false}
                  value={a.content}
                  placeholder={a.kind === 'tags'
                    ? 'filters:\n  - match: from:.*@ejemplo.test\n    tags: Ejemplo, Pedidos'
                    : 'host: smtp.ejemplo.test\nport: 587\nstarttls: true\nusername: usuario\npassword: secreto'}
                  onChange={(e) => setAux((list) => list.map((x) => x.kind === a.kind ? { ...x, content: e.target.value } : x))}
                />
                <div className="mp-aux-actions">
                  <button className="btn tonal" disabled={busy} onClick={() => saveAux(a.kind, a.content)}>
                    <Glyph name="check" size={12} />Guardar {a.label}
                  </button>
                  <span className="mp-hint">Vacía el contenido y guarda para desactivarlo.</span>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      <footer>
        <span className="mp-footer-note">Guardar valida el arranque y revierte si Mailpit no queda saludable.</span>
        <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn primary" onClick={save} disabled={busy}>
          <Glyph name="check" size={13} />{busy ? 'Guardando…' : 'Guardar y reiniciar'}
        </button>
      </footer>
    </Modal>
  )
}
