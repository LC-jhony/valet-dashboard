import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Capas de modal abiertas, de la más antigua a la más reciente. Vive fuera de
 * React para que los atajos globales (que se registran una vez) puedan saber si
 * hay un diálogo delante sin depender del estado de cada componente.
 */
const stack: HTMLElement[] = []

/** ¿Hay algún diálogo abierto? Los atajos globales deben ignorarse mientras sí. */
export const modalsOpen = (): boolean => stack.length > 0

let root: HTMLElement | null = null

/** Contenedor único de diálogos, fuera de `#root` para poder aislar el fondo. */
function modalRoot(): HTMLElement {
  if (root?.isConnected) return root
  const existing = document.getElementById('modal-root')
  if (existing) {
    root = existing
    return root
  }
  const el = document.createElement('div')
  el.id = 'modal-root'
  document.body.appendChild(el)
  root = el
  return el
}

/** Marca como inerte todo lo que no sea el contenedor de diálogos. */
function syncInert() {
  const host = root
  for (const el of Array.from(document.body.children)) {
    if (host && el === host) continue
    if (stack.length > 0) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
  }
}

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null)
}

export interface ModalProps {
  /** Id del título que describe el diálogo. */
  labelledBy: string
  onClose: () => void
  /** Con una operación en curso no se cierra ni con Escape ni con clic fuera. */
  busy?: boolean
  className?: string
  children: ReactNode
}

/**
 * Diálogo modal con lo que un `div` con `role="dialog"` no trae: foco inicial
 * dentro, foco atrapado mientras está abierto, Escape solo para la capa superior
 * y el resto de la aplicación marcado como `inert` mientras tanto.
 *
 * Las teclas se escuchan en `document` y no en el propio diálogo porque el foco
 * puede quedar en un elemento que no es descendiente suyo; aun así se lee en la
 * fase de burbuja para no adelantarse a los manejadores de React de los campos.
 */
export function Modal({ labelledBy, onClose, busy = false, className = '', children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  // Se leen desde el manejador para no volver a suscribirse en cada cambio.
  const busyRef = useRef(busy)
  busyRef.current = busy
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const backdrop = backdropRef.current
    const dialog = dialogRef.current
    if (!backdrop || !dialog) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    stack.push(backdrop)
    syncInert()
    ;(focusables(dialog)[0] ?? dialog).focus()

    const isTop = () => stack[stack.length - 1] === backdrop

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTop()) return
      if (e.key === 'Escape') {
        // La ventana también escucha Escape para cerrar el panel lateral.
        e.stopPropagation()
        if (busyRef.current) return
        e.preventDefault()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables(dialog)
      if (items.length === 0) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !(active instanceof Node) || !dialog.contains(active)
      if (e.shiftKey && (outside || active === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (outside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const index = stack.indexOf(backdrop)
      if (index >= 0) stack.splice(index, 1)
      syncInert()
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  return createPortal(
    <div
      className="backdrop"
      ref={backdropRef}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        className={`dialog ${className}`.trim()}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    modalRoot()
  )
}
