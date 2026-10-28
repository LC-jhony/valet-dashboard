import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdateId, UpdateItem, UpdatesInfo } from '../shared/types'
import { Icon, type IconName } from './icons'
import { Glyph } from './ui-icons'
import { errorMessage } from './errors'

const ICONS: Record<UpdateId, IconName> = {
  php: 'php',
  nginx: 'nginx',
  dnsmasq: 'folder_connection_open',
  composer: 'folder_packages_open',
  valet: 'folder_packages_open',
  node: 'folder_console_open'
}

function useUpdates(active: boolean) {
  const [data, setData] = useState<UpdatesInfo>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const ticket = useRef(0)

  const load = useCallback(async (force = false) => {
    const id = ++ticket.current
    setLoading(true)
    setError('')
    try {
      const info = await window.api.updates.check(force)
      if (ticket.current === id) setData(info)
    } catch (e) {
      if (ticket.current === id) setError(errorMessage(e))
    } finally {
      if (ticket.current === id) setLoading(false)
    }
  }, [])

  // La pestaña sigue montada al cambiar de sección: solo se consulta al
  // entrar, para no lanzar apt y tres peticiones en cada arranque.
  useEffect(() => { if (active) void load() }, [active, load])
  return { data, error, loading, load }
}

/**
 * Una fila por programa: versión instalada, versión disponible y qué puede
 * hacer el panel. Lo que no puede actualizar (Valet externo, Node con nvm) lo
 * dice con el comando manual, en vez de esconder el botón sin explicación.
 */
export function UpdatesPanel({ visible, busy, onRun }: {
  visible: boolean
  busy: boolean
  onRun: (id: UpdateId) => Promise<void>
}) {
  const { data, error, loading, load } = useUpdates(visible)
  const [running, setRunning] = useState<UpdateId | null>(null)
  const items = data?.items ?? []
  const pending = items.filter((i) => i.available)

  const apply = async (item: UpdateItem) => {
    if (item.needsElevation &&
      !confirm(`Actualizar ${item.label} pedirá tu contraseña de administrador. ¿Continuar?`)) return
    setRunning(item.id)
    try {
      await onRun(item.id)
      await load(true)
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="panel" id="install-updates">
      <div className="panel-head">
        <span className="panel-icon"><Icon name="folder_update_open" size={18} /></span>
        <h2 className="panel-title">Programas y actualizaciones</h2>
        <span className={`tag ${pending.length ? 'warn' : 'on'}`}>
          {loading && !data
            ? 'comprobando'
            : pending.length
              ? `${pending.length} ${pending.length === 1 ? 'actualización' : 'actualizaciones'}`
              : 'al día'}
        </span>
      </div>

      <p className="panel-note">
        Compara lo instalado con lo último disponible de PHP, nginx, dnsmasq, Composer, Valet y
        Node.js. El panel actualiza los paquetes del sistema y el Valet que instaló él; cuando el
        programa lo gestiona otra cosa, muestra el comando para hacerlo a mano.
      </p>

      {error && <p className="panel-warn">{error}</p>}
      {data?.warning && <p className="panel-warn">{data.warning}</p>}

      {loading || (!data && !error) ? (
        <div className="updates-loading">
          <Glyph name="spinner" size={14} className="spin" />
          <span>Consultando versiones…</span>
        </div>
      ) : (
        <ul className="rows updates-rows">
          {items.map((item) => (
            <li key={item.id}>
              <div className="row-main">
                <span className="row-icon"><Icon name={ICONS[item.id]} size={18} /></span>
                <div className="row-text">
                  <strong>{item.label}</strong>
                  <small>
                    {item.current ? `Instalado: ${item.current}` : 'No instalado'}
                    {item.available && item.latest && item.latest !== item.current
                      ? ` · disponible: ${item.latest}`
                      : ''}
                  </small>
                  {item.blocked && <small className="updates-blocked">{item.blocked}</small>}
                  {item.available && item.commands.length > 0 && (
                    <span className="updates-commands">
                      {item.commands.map((c) => <code key={c}>{c}</code>)}
                    </span>
                  )}
                </div>
              </div>
              <div className="row-meta">
                {item.available && !item.blocked ? (
                  <button
                    className="btn primary"
                    disabled={busy}
                    aria-label={`Actualizar ${item.label}`}
                    onClick={() => void apply(item)}
                  >
                    <Glyph name="refresh" size={12} />
                    {running === item.id ? 'Actualizando…' : 'Actualizar'}
                  </button>
                ) : item.available ? (
                  <span className="tag warn">a mano</span>
                ) : (
                  <span className="tag on">al día</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="panel-actions">
        <button className="btn" disabled={busy || loading} onClick={() => void load(true)}>
          <Glyph name="refresh" size={13} />{loading ? 'Comprobando…' : 'Comprobar de nuevo'}
        </button>
        <span className="dns-actions-note">
          {data
            ? `Última comprobación: ${new Date(data.checkedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
            : 'Sin datos todavía'}
        </span>
      </div>
    </div>
  )
}
