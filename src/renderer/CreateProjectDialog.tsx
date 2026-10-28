import { useEffect, useRef, useState, type FormEvent } from 'react'
import type {
  CreateProjectEvent, DatabaseConnection, LaravelAnswers, ProjectInfo, Site
} from '../shared/types'
import {
  DATABASE_LABELS, NODE_MANAGERS, PROJECT_NAME_RE, STACK_LABELS,
  databaseChoices, defaultAnswers, defaultDatabasePort, laravelCommand, validateDatabase,
  type DatabaseDriver, type FrontendStack, type NodeManager, type StarterKit
} from '../shared/laravel'
import { errorMessage } from './errors'
import { Glyph } from './ui-icons'
import { Modal } from './Modal'

const MAX_LOG = 60_000
const STEPS = ['Proyecto', 'Interfaz', 'Herramientas', 'Base de datos'] as const
const STARTER_KITS: StarterKit[] = ['react', 'svelte', 'vue', 'livewire']

const NODE_LABELS: Record<NodeManager | 'none', string> = {
  none: 'Ninguno (sin compilar assets)',
  npm: 'npm',
  pnpm: 'pnpm',
  bun: 'bun',
  yarn: 'yarn'
}

function previewUrl(name: string, info: ProjectInfo): string {
  const host = `${name || 'mi-app'}.${info.domain}`
  return `http://${host}${info.httpPort === 80 ? '' : `:${info.httpPort}`}`
}

/** Botón de una elección exclusiva; `seg` es el mismo patrón que usa el resto del panel. */
function Choice<T extends string>({ value, options, onChange, disabled, label }: {
  value: T
  options: { value: T; label: string; hint?: string }[]
  onChange: (value: T) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'on' : ''}
          aria-pressed={o.value === value}
          title={o.hint}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function CreateProjectDialog({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (site: Site) => void
}) {
  const logRef = useRef<HTMLPreElement>(null)
  const [info, setInfo] = useState<ProjectInfo>()
  const [infoError, setInfoError] = useState('')
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<LaravelAnswers>(defaultAnswers)
  const [parentDir, setParentDir] = useState('')
  const [database, setDatabase] = useState<DatabaseConnection>({
    host: '127.0.0.1', port: 3306, database: '', username: 'root', password: ''
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stage, setStage] = useState('')
  const [log, setLog] = useState('')
  const [done, setDone] = useState<Site>()
  const [incomplete, setIncomplete] = useState<{ path: string; message: string }>()

  useEffect(() => {
    let alive = true
    window.api.sites.projectInfo()
      .then((data) => {
        if (!alive) return
        setInfo(data)
        setParentDir((current) => current || data.defaultDir)
        const firstDatabase = data.capabilities.databases[0] ?? 'sqlite'
        setAnswers((a) => ({
          ...a,
          database: firstDatabase,
          node: data.capabilities.nodeManagers[0] ?? 'none'
        }))
        setDatabase((db) => ({ ...db, port: defaultDatabasePort(firstDatabase) }))
      })
      .catch((e: unknown) => { if (alive) setInfoError(errorMessage(e)) })
    return () => { alive = false }
  }, [])

  useEffect(() => window.api.sites.onCreateEvent((ev: CreateProjectEvent) => {
    if (ev.type === 'stage') setStage(ev.label)
    else if (ev.type === 'log') setLog((current) => (current + ev.text).slice(-MAX_LOG))
    else setIncomplete({ path: ev.path, message: ev.message })
  }), [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const set = <K extends keyof LaravelAnswers>(key: K, value: LaravelAnswers[K]) =>
    setAnswers((a) => ({ ...a, [key]: value }))

  const name = answers.name.trim()

  const chooseDatabase = (driver: DatabaseDriver) => {
    set('database', driver)
    setDatabase((db) => ({ ...db, port: defaultDatabasePort(driver) }))
  }

  const problem = (index: number): string => {
    if (index === 0) {
      if (!PROJECT_NAME_RE.test(name)) {
        return 'Nombre no válido: usa minúsculas, números y guiones, sin empezar ni terminar en guion (máx. 63).'
      }
      if (!parentDir.trim()) return 'Elige una carpeta para el proyecto.'
    }
    if (index === 3 && info) {
      if (!info.capabilities.databases.includes(answers.database)) {
        return `${DATABASE_LABELS[answers.database]} no está disponible: falta su extensión PDO en PHP.`
      }
      if (answers.database !== 'sqlite') {
        const issue = validateDatabase(database)[0]
        if (issue) return issue
      }
    }
    return ''
  }

  const next = () => {
    const issue = problem(step)
    if (issue) { setError(issue); return }
    setError('')
    if (step === 2) {
      setDatabase((db) => ({ ...db, database: db.database || name.replace(/-/g, '_') }))
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const back = () => {
    setError('')
    setStep((s) => Math.max(s - 1, 0))
  }

  const pickDirectory = async () => {
    setError('')
    try {
      const dir = await window.api.sites.pickDirectory(parentDir)
      if (dir) setParentDir(dir)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const create = async () => {
    if (!info) return
    const issue = problem(0) || problem(3)
    if (issue) { setError(issue); return }
    setBusy(true)
    setError('')
    setStage('Comprobando el instalador de Laravel…')
    setLog('')
    setDone(undefined)
    setIncomplete(undefined)
    try {
      const site = await window.api.sites.create({
        parentDir: parentDir.trim(),
        answers: { ...answers, name },
        database: answers.database === 'sqlite' ? null : database
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

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy || done) return
    if (step < STEPS.length - 1) next()
    else void create()
  }

  const cancelRun = async () => {
    try { await window.api.sites.cancelCreate() } catch { /* el proceso ya terminó */ }
  }

  const removeIncomplete = async () => {
    if (!incomplete) return
    setError('')
    try {
      await window.api.sites.deleteIncomplete(incomplete.path)
      setIncomplete(undefined)
    } catch (e) {
      setError(errorMessage(e))
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

  const missingRuntime = info && (!info.valetAvailable || (!info.installer.available && !info.composerAvailable))
  const canCreate = Boolean(info && !missingRuntime && !busy && !done && problem(0) === '' && problem(3) === '')

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
        <p className="create-loading"><Glyph name="spinner" size={14} className="spin" />Comprobando el instalador, PHP y Valet…</p>
      ) : (
        <form onSubmit={submit}>
          {missingRuntime && (
            <div className="error" role="alert">
              <Glyph name="alert" size={15} />
              <span>
                {!info.valetAvailable ? 'Valet no está instalado. ' : ''}
                {!info.installer.available && !info.composerAvailable ? 'Falta Composer para instalar el instalador de Laravel. ' : ''}
                Resuélvelo desde la pestaña Instalación.
              </span>
            </div>
          )}

          <ol className="create-steps" aria-label="Pasos del asistente">
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={i === step ? 'on' : i < step ? 'done' : ''}
                aria-current={i === step ? 'step' : undefined}
              >
                <span aria-hidden="true">{i < step ? '✓' : i + 1}</span>{label}
              </li>
            ))}
          </ol>

          <fieldset className="create-fields" disabled={busy || Boolean(done)}>
            {step === 0 && (
              <>
                <div className="field">
                  <span>Nombre del proyecto</span>
                  <input
                    value={answers.name}
                    onChange={(e) => set('name', e.target.value)}
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

                <p className="create-preview">
                  <Glyph name="globe" size={13} />
                  {previewUrl(name, info)}
                </p>
                <p className="create-preview">
                  <Glyph name="terminal" size={13} />
                  {info.installer.available
                    ? <>Instalador de Laravel {info.installer.version ?? ''} listo. Se creará la última versión estable.</>
                    : info.composerAvailable
                      ? <>Falta el instalador: se instalará automáticamente con Composer la primera vez.</>
                      : <>No hay instalador de Laravel ni Composer en este equipo.</>}
                </p>
              </>
            )}

            {step === 1 && (
              <>
                <div className="field">
                  <span>¿Usar un starter kit?</span>
                  <Choice
                    label="Starter kit"
                    value={answers.useStarterKit ? 'yes' : 'no'}
                    onChange={(v) => set('useStarterKit', v === 'yes')}
                    options={[
                      { value: 'yes', label: 'Sí, con autenticación', hint: 'Instala un kit con login y registro incluidos.' },
                      { value: 'no', label: 'No, solo el esqueleto' }
                    ]}
                  />
                  <small className="field-note">
                    El starter kit añade autenticación y una interfaz lista para usar. Sin él, Laravel instala el esqueleto base.
                  </small>
                </div>

                {answers.useStarterKit ? (
                  <>
                    <div className="field">
                      <span>Starter kit</span>
                      <Choice
                        label="Starter kit"
                        value={answers.starterKit}
                        onChange={(v) => set('starterKit', v)}
                        options={STARTER_KITS.map((k) => ({ value: k, label: STACK_LABELS[k] }))}
                      />
                    </div>

                    <div className="field">
                      <span>Autenticación</span>
                      <Choice
                        label="Proveedor de autenticación"
                        value={answers.authProvider}
                        onChange={(v) => set('authProvider', v)}
                        options={[
                          { value: 'laravel', label: 'Laravel', hint: 'Autenticación incluida en el propio proyecto.' },
                          { value: 'workos', label: 'WorkOS', hint: 'Requiere configurar una cuenta de WorkOS después.' }
                        ]}
                      />
                      {answers.authProvider === 'workos' && (
                        <small className="field-note">WorkOS necesita credenciales propias; el proyecto se crea sin ellas.</small>
                      )}
                    </div>

                    {answers.starterKit === 'livewire' && answers.authProvider === 'laravel' && (
                      <>
                        <div className="field">
                          <span>Componentes de Livewire</span>
                          <Choice
                            label="Tipo de componentes Livewire"
                            value={answers.livewireSingleFile ? 'single' : 'class'}
                            onChange={(v) => set('livewireSingleFile', v === 'single')}
                            options={[
                              { value: 'single', label: 'Archivo único' },
                              { value: 'class', label: 'Clases', hint: 'Componentes Livewire clásicos de clase.' }
                            ]}
                          />
                        </div>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={answers.teams && answers.livewireSingleFile}
                            disabled={!answers.livewireSingleFile}
                            onChange={(e) => set('teams', e.target.checked)}
                          />
                          Añadir soporte de equipos
                        </label>
                        {!answers.livewireSingleFile && (
                          <small className="field-note">Los equipos solo se ofrecen con componentes de archivo único.</small>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <div className="field">
                    <span>Stack de frontend</span>
                    <Choice
                      label="Stack de frontend"
                      value={answers.frontendStack}
                      onChange={(v: FrontendStack) => set('frontendStack', v)}
                      options={(['blade', 'react', 'svelte', 'vue', 'livewire'] as FrontendStack[])
                        .map((k) => ({ value: k, label: STACK_LABELS[k] }))}
                    />
                    <small className="field-note">Blade deja el esqueleto clásico sin autenticación. Los demás añaden su stack, pero sin kit de autenticación.</small>
                  </div>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <div className="field">
                  <span>Pruebas</span>
                  <Choice
                    label="Framework de pruebas"
                    value={answers.testing}
                    onChange={(v) => set('testing', v)}
                    options={[
                      { value: 'pest', label: 'Pest' },
                      { value: 'phpunit', label: 'PHPUnit' }
                    ]}
                  />
                </div>

                <div className="field">
                  <span>Gestor de Node</span>
                  <select
                    value={answers.node}
                    onChange={(e) => set('node', e.target.value as NodeManager | 'none')}
                    aria-label="Gestor de Node"
                  >
                    <option value="none">{NODE_LABELS.none}</option>
                    {NODE_MANAGERS.filter((m) => info.capabilities.nodeManagers.includes(m)).map((m) => (
                      <option key={m} value={m}>{NODE_LABELS[m]}</option>
                    ))}
                  </select>
                  <small className="field-note">Instala las dependencias y compila los assets del proyecto.</small>
                </div>

                <label className="check">
                  <input type="checkbox" checked={answers.boost} onChange={(e) => set('boost', e.target.checked)} />
                  Instalar Laravel Boost
                </label>

                <label className="check">
                  <input type="checkbox" checked={answers.git} onChange={(e) => set('git', e.target.checked)} />
                  Inicializar un repositorio Git
                </label>
              </>
            )}

            {step === 3 && (
              <>
                <div className="field">
                  <span>Base de datos</span>
                  <div className="seg" role="group" aria-label="Base de datos">
                    {databaseChoices(info.capabilities.databases).map(({ driver, available }) => (
                      <button
                        key={driver}
                        type="button"
                        className={driver === answers.database ? 'on' : ''}
                        aria-pressed={driver === answers.database}
                        disabled={!available}
                        title={available ? undefined : 'Falta la extensión PDO correspondiente en PHP.'}
                        onClick={() => chooseDatabase(driver)}
                      >
                        {DATABASE_LABELS[driver]}
                      </button>
                    ))}
                  </div>
                  {info.capabilities.databases.length === 0 && (
                    <small className="field-note">PHP no tiene ninguna extensión PDO: instálala antes de crear el proyecto.</small>
                  )}
                  {!info.capabilities.databases.includes('sqlite') && info.capabilities.databases.length > 0 && (
                    <small className="field-note">SQLite aparece deshabilitado porque PHP no tiene pdo_sqlite.</small>
                  )}
                </div>

                {answers.database !== 'sqlite' ? (
                  <>
                    <div className="create-grid">
                      <label className="field">
                        <span>Host</span>
                        <input
                          value={database.host}
                          onChange={(e) => setDatabase({ ...database, host: e.target.value })}
                          spellCheck={false}
                        />
                      </label>
                      <label className="field">
                        <span>Puerto</span>
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          value={database.port}
                          onChange={(e) => setDatabase({ ...database, port: Number(e.target.value) || 0 })}
                        />
                      </label>
                      <label className="field">
                        <span>Base de datos</span>
                        <input
                          value={database.database}
                          onChange={(e) => setDatabase({ ...database, database: e.target.value })}
                          spellCheck={false}
                        />
                      </label>
                      <label className="field">
                        <span>Usuario</span>
                        <input
                          value={database.username}
                          onChange={(e) => setDatabase({ ...database, username: e.target.value })}
                          spellCheck={false}
                          autoComplete="off"
                        />
                      </label>
                      <label className="field create-wide">
                        <span>Contraseña</span>
                        <input
                          type="password"
                          value={database.password}
                          onChange={(e) => setDatabase({ ...database, password: e.target.value })}
                          autoComplete="new-password"
                        />
                      </label>
                    </div>
                    <small className="field-note">
                      La base de datos debe existir y admitir esas credenciales: el instalador ejecuta las migraciones.
                      Los secretos van por el entorno del proceso, nunca en el comando ni en el registro.
                    </small>
                    {problem(3) && <small className="field-note create-blocked">{problem(3)}</small>}
                  </>
                ) : (
                  <small className="field-note">Laravel crea database/database.sqlite y ejecuta las migraciones.</small>
                )}

                <div className="field">
                  <span>Comando</span>
                  <pre className="create-command">{laravelCommand({ ...answers, name }, info.capabilities.flags)}</pre>
                </div>
              </>
            )}
          </fieldset>

          {error && <div className="error" role="alert"><Glyph name="alert" size={15} /><span>{error}</span></div>}

          {(busy || log) && (
            <div className="create-progress">
              {busy && <p className="create-stage"><Glyph name="spinner" size={13} className="spin" />{stage || 'Preparando…'}</p>}
              {log && <pre className="log create-log" ref={logRef}>{log}</pre>}
            </div>
          )}

          {incomplete && !busy && (
            <div className="create-incomplete" role="alert">
              <Glyph name="alert" size={16} />
              <div>
                <strong>La carpeta quedó incompleta</strong>
                <p>{incomplete.path}</p>
                <p>Puedes eliminarla y volver a intentarlo. No se toca ningún sitio registrado en Valet.</p>
                <button type="button" className="btn danger" onClick={removeIncomplete}>
                  <Glyph name="close" size={13} />Eliminar carpeta incompleta
                </button>
              </div>
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
            ) : busy ? (
              <>
                <button type="button" className="btn" onClick={cancelRun}>
                  <Glyph name="stop" size={13} />Detener
                </button>
                <button type="button" className="btn primary" disabled>
                  <Glyph name="spinner" size={13} className="spin" />Creando…
                </button>
              </>
            ) : (
              <>
                {step > 0 && (
                  <button type="button" className="btn ghost" onClick={back}>Atrás</button>
                )}
                <button type="button" className="btn" onClick={onClose}>Cancelar</button>
                <button type="submit" className="btn primary" disabled={step === STEPS.length - 1 && !canCreate}>
                  {step === STEPS.length - 1 ? <Glyph name="plus" size={13} /> : null}
                  {step === STEPS.length - 1 ? 'Crear proyecto' : 'Continuar'}
                </button>
              </>
            )}
          </footer>
        </form>
      )}
    </Modal>
  )
}
