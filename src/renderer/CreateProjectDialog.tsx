import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CreateProjectEvent, ProjectInfo, Site } from '../shared/types'
import { errorMessage } from './errors'
import { Glyph } from './ui-icons'
import { Modal } from './Modal'

const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const MAX_LOG = 60_000

function previewUrl(name: string, info: ProjectInfo): string {
  const host = `${name || 'mi-app'}.${info.domain}`
  return `http://${host}${info.httpPort === 80 ? '' : `:${info.httpPort}`}`
}

export function CreateProjectDialog({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (site: Site) => void
}) {
  const logRef = useRef<HTMLPreElement>(null)
  const [info, setInfo] = useState<ProjectInfo>()
  const [infoError, setInfoError] = useState('')
  const [name, setName] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [versionMode, setVersionMode] = useState<'latest' | 'custom'>('latest')
  const [version, setVersion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stage, setStage] = useState('')
  const [log, setLog] = useState('')
  const [done, setDone] = useState<Site>()

  useEffect(() => {
    let alive = true
    window.api.sites.projectInfo()
      .then((data) => {
        if (!alive) return
        setInfo(data)
        setParentDir((current) => current || data.defaultDir)
      })
      .catch((e: unknown) => { if (alive) setInfoError(errorMessage(e)) })
    return () => { alive = false }
  }, [])

  useEffect(() => window.api.sites.onCreateEvent((ev: CreateProjectEvent) => {
    if (ev.type === 'stage') setStage(ev.label)
    else setLog((current) => (current + ev.text).slice(-MAX_LOG))
  }), [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const pickDirectory = async () => {
    setError('')
    try {
      const dir = await window.api.sites.pickDirectory(parentDir)
      if (dir) setParentDir(dir)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!info) return
    const project = name.trim()
    if (!NAME_RE.test(project)) {
      setError('Nombre no válido: usa minúsculas, números y guiones, sin empezar ni terminar en guion.')
      return
    }
    if (!parentDir.trim()) {
      setError('Elige una carpeta para el proyecto.')
      return
    }
    if (versionMode === 'custom' && !version.trim()) {
      setError('Escribe una versión de Laravel, por ejemplo 12.*.')
      return
    }
    setBusy(true)
    setError('')
    setStage('Validando la configuración…')
    setLog('')
    setDone(undefined)
    try {
      const site = await window.api.sites.create({
        name: project,
        parentDir: parentDir.trim(),
        version: versionMode === 'custom' ? version.trim() : ''
      })
      setDone(site)
      setStage('Proyecto creado')
      onCreated(site)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const openSite = async () => {
    if (!done) return
    setError('')
    try {
      await window.api.sites.open(done.name)
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const canCreate = Boolean(
    info?.composerAvailable && info?.valetAvailable &&
    NAME_RE.test(name.trim()) && parentDir.trim() &&
    (versionMode === 'latest' || version.trim()) &&
    !busy && !done
  )

  return (
    <Modal labelledBy="cp-title" onClose={onClose} busy={busy} className="create-dialog">
      <header className="page-head">
        <h1 id="cp-title">Nuevo proyecto Laravel</h1>
        <button className="btn ghost" onClick={onClose} disabled={busy} aria-label="Cerrar">
          <Glyph name="close" size={13} />Cerrar
        </button>
      </header>

      {infoError ? (
        <>
          <div className="error" role="alert"><Glyph name="alert" size={15} /><span>{infoError}</span></div>
          <footer><button className="btn" onClick={onClose}>Cerrar</button></footer>
        </>
      ) : !info ? (
        <p className="create-loading"><Glyph name="spinner" size={14} className="spin" />Comprobando Composer y Valet…</p>
      ) : (
        <form onSubmit={submit}>
          {(!info.composerAvailable || !info.valetAvailable) && (
            <div className="error" role="alert">
              <Glyph name="alert" size={15} />
              <span>
                {!info.composerAvailable ? 'Composer no está instalado. ' : ''}
                {!info.valetAvailable ? 'Valet no está instalado. ' : ''}
                Instálalos desde la pestaña Instalación para crear proyectos.
              </span>
            </div>
          )}

          <fieldset className="create-fields" disabled={busy || Boolean(done)}>
            <div className="field">
              <span>Nombre del proyecto</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="mi-app"
                spellCheck={false}
                autoFocus
              />
              <small className="field-note">Minúsculas, números y guiones. Será el nombre de la carpeta y del sitio.</small>
            </div>

            <div className="field">
              <span>Carpeta de proyectos</span>
              <div className="path-row">
                <input
                  value={parentDir}
                  onChange={(e) => setParentDir(e.target.value)}
                  placeholder="~/Sites"
                  spellCheck={false}
                />
                <button type="button" className="btn" onClick={pickDirectory}>Elegir…</button>
              </div>
              {info.parkedPaths.length > 0 && (
                <select
                  value={info.parkedPaths.includes(parentDir) ? parentDir : ''}
                  onChange={(e) => e.target.value && setParentDir(e.target.value)}
                  aria-label="Carpetas aparcadas"
                >
                  <option value="">Elegir una carpeta aparcada…</option>
                  {info.parkedPaths.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
              <small className="field-note">Si no está aparcada, el proyecto se enlazará con valet link.</small>
            </div>

            <div className="field">
              <span>Versión de Laravel</span>
              <select
                value={versionMode}
                onChange={(e) => setVersionMode(e.target.value === 'custom' ? 'custom' : 'latest')}
                aria-label="Versión de Laravel"
              >
                <option value="latest">Última estable</option>
                <option value="custom">Otra versión…</option>
              </select>
              {versionMode === 'custom' && (
                <input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="12.*"
                  spellCheck={false}
                />
              )}
            </div>

            <p className="create-preview">
              <Glyph name="globe" size={13} />
              {previewUrl(name.trim(), info)}
            </p>
          </fieldset>

          {error && <div className="error" role="alert"><Glyph name="alert" size={15} /><span>{error}</span></div>}

          {(busy || log) && (
            <div className="create-progress">
              {busy && <p className="create-stage"><Glyph name="spinner" size={13} className="spin" />{stage || 'Preparando…'}</p>}
              {log && <pre className="log create-log" ref={logRef}>{log}</pre>}
            </div>
          )}

          {done && !busy && (
            <div className="create-success">
              <Glyph name="check" size={16} />
              <div>
                <strong>Proyecto creado</strong>
                <p>{done.path}</p>
                <p><code>{done.url}</code></p>
              </div>
            </div>
          )}

          <footer>
            {done ? (
              <>
                <button type="button" className="btn" onClick={onClose}>Cerrar</button>
                <button type="button" className="btn primary" onClick={openSite} disabled={!done.url}>
                  <Glyph name="globe" size={13} />Abrir sitio
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
                <button type="submit" className="btn primary" disabled={!canCreate}>
                  {busy ? <Glyph name="spinner" size={13} className="spin" /> : <Glyph name="plus" size={13} />}
                  {busy ? 'Creando…' : 'Crear proyecto'}
                </button>
              </>
            )}
          </footer>
        </form>
      )}
    </Modal>
  )
}
