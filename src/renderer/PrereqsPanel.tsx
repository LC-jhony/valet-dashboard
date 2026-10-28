import { useRef, useState } from 'react'
import type { Env } from '../shared/types'
import { Icon } from './icons'
import { Glyph } from './ui-icons'

/** Bloque de comandos con botón de copiar. Nunca ejecuta nada por su cuenta. */
export function CommandBlock({ commands }: { commands: string[] }) {
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLPreElement>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(commands.join('\n'))
      setCopied(true)
    } catch {
      // Sin permiso de portapapeles: se selecciona para copiar con Ctrl+C.
      const el = ref.current
      const selection = window.getSelection()
      if (el && selection) {
        const range = document.createRange()
        range.selectNodeContents(el)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
  }

  return (
    <div className="cmd-block">
      <pre className="cmd" ref={ref}>{commands.join('\n')}</pre>
      <button type="button" className="btn ghost" onClick={copy}>
        <Glyph name={copied ? 'check' : 'terminal'} size={13} />
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}

/**
 * Requisitos que el panel no puede resolver solo. Cada uno trae el comando que
 * lo arregla, para que un sistema recién instalado no quede en un callejón.
 */
export function PrereqsPanel({ env, onRecheck }: { env: Env; onRecheck: () => void }) {
  const blocking = env.prereqs.filter((p) => !p.ok && p.blocking)
  const pending = env.prereqs.filter((p) => !p.ok && !p.blocking)
  const missing = [...blocking, ...pending]
  if (!missing.length) {
    return (
      <div className="panel" id="install-prereqs">
        <div className="panel-head">
          <span className="panel-icon"><Icon name="folder_config_open" size={18} /></span>
          <h2 className="panel-title">Requisitos previos</h2>
          <span className="tag on"><Glyph name="check" size={11} />todo listo</span>
          <button type="button" className="btn ghost" onClick={onRecheck}>Volver a comprobar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="panel" id="install-prereqs">
      <div className="panel-head">
        <span className="panel-icon"><Icon name="folder_config_open" size={18} /></span>
        <h2 className="panel-title">Requisitos previos</h2>
        <span className={`tag ${blocking.length ? 'warn' : ''}`}>
          {blocking.length ? `${blocking.length} bloquean la instalación` : `${pending.length} avisos`}
        </span>
        <button type="button" className="btn ghost" onClick={onRecheck}>Volver a comprobar</button>
      </div>
      <p className="panel-note">
        Copia los comandos en una terminal. Cuando termines, pulsa <strong>Volver a comprobar</strong>.
      </p>
      <ul className="prereq-list">
        {missing.map((p) => (
          <li key={p.id} className={p.blocking ? 'blocking' : 'warning'}>
            <div className="prereq-head">
              <Glyph name="alert" size={14} />
              <strong>{p.label}</strong>
              <span className="prereq-detail">{p.detail}</span>
            </div>
            {p.commands.length > 0 && <CommandBlock commands={p.commands} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Motivo visible por el que no se puede instalar. Devuelve texto vacío cuando
 * todo está en orden; la interfaz lo muestra bajo el botón.
 */
export function installBlockReason(
  env: Env | undefined,
  opts: { busy: boolean; portBlocked: boolean; dnsMode: string; safeAvailable: boolean }
): string {
  if (!env) return 'Cargando el diagnóstico del sistema…'
  if (opts.busy) return 'Hay una operación en curso.'
  const blocking = env.prereqs.filter((p) => !p.ok && p.blocking)
  if (blocking.length) {
    return `Faltan requisitos: ${blocking.map((p) => p.label).join(', ')}. Sigue la guía de requisitos previos.`
  }
  if (opts.portBlocked) {
    return 'Los puertos 80/443 están ocupados por otro proceso. Libéralos o marca la opción de detener Apache.'
  }
  if (opts.dnsMode === 'safe' && !opts.safeAvailable) {
    return 'El modo Seguro no está disponible en este sistema. Elige Hosts.'
  }
  return ''
}
