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
  { id: 'service', label: 'Service' },
  ...MAILPIT_GROUPS.map((g) => ({ id: g.id as Tab, label: g.label })),
  { id: 'auth', label: 'Authentication' },
  { id: 'tls', label: 'TLS' },
  { id: 'yaml', label: 'YAML' },
  { id: 'advanced', label: 'Advanced' }
]

const AUTH_ROWS = [
  ['ui', 'Web UI and API', 'Protects the mailbox and the API with Basic Auth.'],
  ['smtp', 'SMTP', 'Requires a username and password from SMTP clients.'],
  ['pop3', 'POP3', 'Protects the POP3 server.'],
  ['sendApi', 'Send API', 'Separate credentials for /api/v1/send only.']
] as const

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function parseAdvanced(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const idx = trimmed.indexOf('=')
    if (idx < 1) throw new Error(`Line ${i + 1}: use the format MP_KEY=value`)
    const key = trimmed.slice(0, idx).trim()
    if (!/^MP_[A-Z0-9_]+$/.test(key)) throw new Error(`Line ${i + 1}: invalid key “${key}”`)
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
      setNotice('YAML file saved and Mailpit restarted.')
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
        <h1 id="mp-title">Mailpit settings</h1>
        <button className="btn ghost" onClick={onClose} disabled={busy} aria-label="Close settings">
          <Glyph name="close" size={13} />Close
        </button>
      </header>

      <div className="mp-tabs" role="tablist" aria-label="Settings sections">
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
            <h3>Runtime</h3>
            <p className="mp-hint">Mailpit runs as a systemd user service and keeps capturing mail after the panel is closed.</p>
            <div className="mp-grid">
              <label className="mp-field">
                <span>Binary</span>
                <select
                  value={draft.binarySource}
                  onChange={(e) => setDraft((d) => ({ ...d, binarySource: e.target.value === 'system' ? 'system' : 'managed' }))}
                >
                  <option value="managed">Panel-managed copy</option>
                  <option value="system">System Mailpit</option>
                </select>
                <small>{info.binary ? `In use: ${info.binary}` : 'No binary yet'}</small>
              </label>
              {draft.binarySource === 'system' && (
                <label className="mp-field">
                  <span>System Mailpit path</span>
                  <input
                    value={draft.systemBinary}
                    placeholder="/usr/local/bin/mailpit"
                    spellCheck={false}
                    onChange={(e) => setDraft((d) => ({ ...d, systemBinary: e.target.value }))}
                  />
                  <small>{info.systemBinary ? `Detected: ${info.systemBinary}` : 'mailpit was not found in PATH'}</small>
                </label>
              )}
              <label className="mp-field">
                <span>GitHub token (optional)</span>
                <input
                  type="password"
                  value={draft.githubToken}
                  autoComplete="new-password"
                  placeholder="ghp_…"
                  onChange={(e) => setDraft((d) => ({ ...d, githubToken: e.target.value }))}
                />
                <small>Avoids the request limit when checking releases.</small>
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
                <span>Start at login</span>
                <small>Enables the unit with <code>systemctl --user enable</code>.</small>
              </span>
            </label>
            <div className="mp-paths">
              <span>Unit: <code>{info.unitPath}</code></span>
              <span>Environment: <code>{info.envPath}</code></span>
              <span>Configuration: <code>{info.configPath}</code></span>
              <span>Database: <code>{info.database}</code></span>
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
                  {advanced ? 'Hide advanced options' : 'Show advanced options'}
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
            <h3>Authentication</h3>
            <p className="mp-hint">
              Password files are generated in <code>~/.config/valet-dashboard/mailpit/auth</code> with
              <code> 0600</code> permissions. If <code>htpasswd</code> is available, bcrypt is used; otherwise plain text is stored.
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
                        <span>{a.enabled ? 'enabled' : 'disabled'}</span>
                      </label>
                    </div>
                    <small>{hint}</small>
                    {a.enabled && (
                      <>
                        <label className="mp-field"><span>User</span>
                          <input value={a.user} spellCheck={false} autoComplete="off" onChange={(e) => setAuth(kind, { user: e.target.value })} />
                        </label>
                        <label className="mp-field"><span>Password</span>
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
            <p className="mp-hint">The same certificate applies to the UI/API, SMTP and POP3. The self-signed certificate is generated with <code>openssl</code> for localhost.</p>
            <label className="mp-toggle">
              <input type="checkbox" checked={draft.tls.enabled} onChange={(e) => setTls({ enabled: e.target.checked })} />
              <span className="mp-toggle-track" aria-hidden="true"><span /></span>
              <span className="mp-toggle-text"><span>Enable TLS</span><small>HTTPS in the UI and STARTTLS/TLS for mail.</small></span>
            </label>
            {draft.tls.enabled && (
              <>
                <label className="mp-toggle">
                  <input type="checkbox" checked={draft.tls.selfSigned} onChange={(e) => setTls({ selfSigned: e.target.checked })} />
                  <span className="mp-toggle-track" aria-hidden="true"><span /></span>
                  <span className="mp-toggle-text"><span>Self-signed certificate</span><small>The panel accepts this certificate only for the embedded view.</small></span>
                </label>
                {!draft.tls.selfSigned && (
                  <div className="mp-grid">
                    <label className="mp-field"><span>Certificate</span>
                      <input value={draft.tls.cert} placeholder="/path/cert.pem" spellCheck={false} onChange={(e) => setTls({ cert: e.target.value })} />
                    </label>
                    <label className="mp-field"><span>Private key</span>
                      <input value={draft.tls.key} placeholder="/path/key.pem" spellCheck={false} onChange={(e) => setTls({ key: e.target.value })} />
                    </label>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {tab === 'advanced' && (
          <section className="mp-section">
            <h3>Advanced editor</h3>
            <p className="mp-hint">
              One <code>MP_KEY=value</code> option per line. Use it for new variables or ones the form does not cover.
              The panel manages the authentication and TLS paths.
            </p>
            <textarea
              className="mp-textarea"
              rows={14}
              spellCheck={false}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={'MP_SOME_OPTION=value\nMP_OTHER=1'}
            />
            <p className="mp-hint">{mailpitOptionEntries(draft.options).length} custom options detected.</p>
          </section>
        )}

        {tab === 'yaml' && (
          <section className="mp-section">
            <h3>YAML files</h3>
            <p className="mp-hint">
              Relay, forward and tags use YAML files. Saving non-empty content enables the matching option
              and restarts Mailpit; if the YAML is not valid, it is rolled back.
            </p>
            {aux.map((a) => (
              <div className="mp-aux" key={a.kind}>
                <div className="mp-aux-head">
                  <strong>{a.label}</strong>
                  <span className={`tag ${a.enabled ? 'on' : ''}`}>{a.enabled ? 'active' : 'not enabled'}</span>
                  <code>{a.path}</code>
                </div>
                <textarea
                  className="mp-textarea"
                  rows={6}
                  spellCheck={false}
                  value={a.content}
                  placeholder={a.kind === 'tags'
                    ? 'filters:\n  - match: from:.*@example.test\n    tags: Example, Orders'
                    : 'host: smtp.example.test\nport: 587\nstarttls: true\nusername: user\npassword: secret'}
                  onChange={(e) => setAux((list) => list.map((x) => x.kind === a.kind ? { ...x, content: e.target.value } : x))}
                />
                <div className="mp-aux-actions">
                  <button className="btn tonal" disabled={busy} onClick={() => saveAux(a.kind, a.content)}>
                    <Glyph name="check" size={12} />Save {a.label}
                  </button>
                  <span className="mp-hint">Empty the content and save to disable it.</span>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      <footer>
        <span className="mp-footer-note">Saving validates startup and rolls back if Mailpit does not come up healthy.</span>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={busy}>
          <Glyph name="check" size={13} />{busy ? 'Saving…' : 'Save and restart'}
        </button>
      </footer>
    </Modal>
  )
}
