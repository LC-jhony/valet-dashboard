import { useEffect, useState } from 'react'

export type Mode = 'system' | 'light' | 'dark'
export type PaletteId = 'carbon' | 'min'
export type FontKey = 'system' | 'mono' | 'serif' | 'custom'
export type IconThemeId = 'dawn' | 'deep' | 'dim' | 'you'
export interface Settings {
  mode: Mode
  palette: PaletteId
  font: FontKey
  customFont: string
  fontSize: number
  compact: boolean
  iconTheme: IconThemeId
}

export const DEFAULTS: Settings = {
  mode: 'system', palette: 'carbon', font: 'system', customFont: '', fontSize: 15, compact: false, iconTheme: 'dawn'
}

const MODES: Mode[] = ['system', 'light', 'dark']
const FONT_KEYS: FontKey[] = ['system', 'mono', 'serif', 'custom']
const ICON_THEMES: IconThemeId[] = ['dawn', 'deep', 'dim', 'you']

export interface Colors {
  bg: string; panel: string; ink: string; muted: string; line: string; accent: string; warn: string; ok: string
  nav: string; navInk: string; navMuted: string
  /**
   * Fondo de los controles rellenos (botón primario, segmentos activos). Se
   * separa de `accent` cuando el acento es demasiado claro para llevar texto
   * blanco: el acento sigue sirviendo para iconos, bordes y texto sobre el
   * fondo, y el relleno se oscurece lo justo para que el blanco llegue a AA.
   */
  accentFill?: string
}

/** Colores tomados de los temas de VS Code incluidos en ./themes (Carbon y Min). */
export const PALETTES: Record<PaletteId, { name: string; light: Colors; dark: Colors }> = {
  carbon: {
    name: 'Carbon',
    dark: { bg: '#171717', panel: '#1E1E1E', ink: '#C9CCCD', muted: '#8993A4', line: '#2A2A2A', accent: '#FF4262', accentFill: '#E11D48', warn: '#E8A33D', ok: '#57A464', nav: '#171717', navInk: '#C9CCCD', navMuted: '#8993A4' },
    light: { bg: '#FFFFFF', panel: '#F8FAFC', ink: '#2C3E50', muted: '#4A5568', line: '#E2E8F0', accent: '#FF4262', accentFill: '#E11D48', warn: '#B7791F', ok: '#276749', nav: '#F1F5F9', navInk: '#2C3E50', navMuted: '#4A5568' }
  },
  min: {
    name: 'Min',
    dark: { bg: '#1F1F1F', panel: '#262626', ink: '#E0E0E0', muted: '#939393', line: '#363636', accent: '#79B8FF', accentFill: '#0E639C', warn: '#F97583', ok: '#7BC47F', nav: '#1A1A1A', navInk: '#C1C1C1', navMuted: '#7D7D7D' },
    light: { bg: '#FFFFFF', panel: '#F6F6F6', ink: '#212121', muted: '#757575', line: '#E0E0E0', accent: '#1976D2', warn: '#D32F2F', ok: '#22863A', nav: '#F6F6F6', navInk: '#424242', navMuted: '#757575' }
  }
}

const FONTS: Record<Exclude<FontKey, 'custom'>, string> = {
  system: '"Cantarell", "Ubuntu", "Noto Sans", system-ui, sans-serif',
  mono: 'ui-monospace, "JetBrains Mono", "Ubuntu Mono", monospace',
  serif: '"Noto Serif", Georgia, serif'
}

const KEY = 'valet-dashboard:settings'
const dark = () => matchMedia('(prefers-color-scheme: dark)')
export const resolveMode = (m: Mode): 'light' | 'dark' => (m === 'system' ? (dark().matches ? 'dark' : 'light') : m)

/** Luminancia relativa de un color `#rrggbb` según WCAG 2.1. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contraste WCAG entre dos luminancias relativas. */
export const contrastRatio = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

const ACCENT_INK = ['#111111', '#FFFFFF'] as const

/**
 * Color del texto sobre un fondo de acento: el que más contraste da, no el que
 * parece más oscuro. Un umbral fijo deja textos blancos sobre acentos medios
 * como el rojo de Carbon, con un contraste de 3,4:1 (por debajo de AA).
 */
export function onAccent(hex: string): string {
  const bg = luminance(hex)
  const [dark, light] = ACCENT_INK
  return contrastRatio(bg, luminance(dark)) >= contrastRatio(bg, luminance(light)) ? dark : light
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

const toHex = (rgb: number[]) =>
  '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')

/** Mezcla opaca: `weight` de `a` y el resto de `b`, como `color-mix` en srgb. */
export function mix(a: string, b: string, weight: number): string {
  const [x, y] = [channels(a), channels(b)]
  return toHex(x.map((v, i) => v * weight + y[i] * (1 - weight)))
}

/** `fg` con alfa `alpha` sobre un fondo opaco. */
export const over = (fg: string, bg: string, alpha: number) => mix(fg, bg, alpha)

const toHsl = (hex: string): [number, number, number] => {
  const [r, g, b] = channels(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

const fromHsl = (h: number, s: number, l: number): string => {
  if (s <= 0) {
    const v = l * 255
    return toHex([v, v, v])
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return toHex([channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255])
}

/**
 * Aclara (`lighten`) u oscurece `fg` manteniendo tono y saturación hasta que
 * alcance `target` sobre todos los fondos indicados. Cambiar solo la
 * luminosidad conserva el color de marca; mezclar con el gris del texto lo
 * apagaría (un ámbar de aviso acabaría marrón).
 */
export function readableOn(fg: string, bgs: string[], lighten: boolean, target = 4.5): string {
  const passes = (c: string) => bgs.every((b) => contrastRatio(luminance(c), luminance(b)) >= target)
  if (passes(fg)) return fg
  const [h, s, l] = toHsl(fg)
  const dir = lighten ? 0.02 : -0.02
  for (let step = 1; step <= 50; step++) {
    const next = l + dir * step
    if (next > 1 || next < 0) break
    const c = fromHsl(h, s, next)
    if (passes(c)) return c
  }
  return lighten ? '#FFFFFF' : '#111111'
}

export interface Inks { accent: string; warn: string; ok: string; muted: string; navMuted: string }

/**
 * Tonos de texto derivados de la paleta. Un mismo color no sirve para icono y
 * para texto: el acento de Carbon claro da 3,2:1 sobre blanco y 2,8:1 sobre su
 * propio tinte, así que el texto se oscurece (o se aclara en oscuro) lo justo.
 * Los fondos del cálculo son los que usa la hoja de estilos: panel, fondo, barra
 * lateral y los tintes de acento (13 %), aviso (15 %) y verde (12 %).
 */
export function deriveInks(c: Colors): Inks {
  const lighten = luminance(c.ink) > luminance(c.bg)
  const accentBgs = [
    c.panel, c.bg, c.nav,
    over(c.accent, c.panel, 0.13), over(c.accent, c.bg, 0.13), over(c.accent, c.nav, 0.11)
  ]
  const warnBgs = [
    c.panel, c.bg, c.nav,
    over(c.warn, c.panel, 0.15), over(c.warn, c.bg, 0.15), over(c.warn, c.nav, 0.15)
  ]
  const okBgs = [c.panel, c.bg, over(c.ok, c.panel, 0.12), over(c.ok, c.bg, 0.12)]
  const mutedBgs = [
    c.panel, c.bg, mix(c.panel, c.bg, 0.4),
    over(c.ink, c.panel, 0.06), over(c.ink, c.bg, 0.06), over(c.ink, c.panel, 0.1)
  ]
  const navMutedBgs = [c.nav, over(c.navInk, c.nav, 0.09)]
  return {
    accent: readableOn(c.accent, accentBgs, lighten),
    warn: readableOn(c.warn, warnBgs, lighten),
    ok: readableOn(c.ok, okBgs, lighten),
    muted: readableOn(c.muted, mutedBgs, lighten),
    navMuted: readableOn(c.navMuted, navMutedBgs, lighten)
  }
}

export function loadSettings(): Settings {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as Settings
    if (!MODES.includes(s.mode)) s.mode = DEFAULTS.mode
    if (!(s.palette in PALETTES)) s.palette = DEFAULTS.palette
    if (!FONT_KEYS.includes(s.font)) s.font = DEFAULTS.font
    if (!ICON_THEMES.includes(s.iconTheme)) s.iconTheme = DEFAULTS.iconTheme
    s.fontSize = Math.min(20, Math.max(12, Number(s.fontSize) || DEFAULTS.fontSize))
    return s
  } catch { return DEFAULTS }
}

export function applySettings(s: Settings) {
  const mode = resolveMode(s.mode)
  const c = PALETTES[s.palette][mode]
  const isDark = mode === 'dark'
  const root = document.documentElement
  const accentFill = c.accentFill ?? c.accent
  const inks = deriveInks(c)
  const vars: Record<string, string> = {
    bg: c.bg, panel: c.panel, ink: c.ink, muted: inks.muted, line: c.line, accent: c.accent,
    'accent-fill': accentFill, 'accent-ink': inks.accent, 'warn-ink': inks.warn, 'ok-ink': inks.ok,
    warn: c.warn, ok: c.ok,
    nav: c.nav, 'nav-ink': c.navInk, 'nav-muted': inks.navMuted, 'on-accent': onAccent(accentFill),
    shadow: isDark ? '0 18px 48px rgb(0 0 0 / 0.4)' : '0 18px 48px rgb(15 23 42 / 0.14)',
    'shadow-lg': isDark ? '0 24px 64px rgb(0 0 0 / 0.52)' : '0 24px 64px rgb(15 23 42 / 0.2)',
    overlay: isDark ? 'rgb(0 0 0 / 0.55)' : 'rgb(15 23 42 / 0.3)'
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--${k}`, v)
  const custom = s.customFont.replace(/[^\w\s-]/g, '').trim()
  root.style.setProperty('--font', s.font === 'custom' && custom ? `"${custom}", system-ui, sans-serif` : FONTS[s.font === 'custom' ? 'system' : s.font])
  root.style.setProperty('--fs', `${s.fontSize}px`)
  root.style.colorScheme = mode
  root.dataset.compact = String(s.compact)
  root.dataset.iconTheme = s.iconTheme
}

/** Modo claro/oscuro efectivo; se vuelve a calcular si el sistema cambia. */
export function useResolvedMode(mode: Mode): 'light' | 'dark' {
  const [resolved, setResolved] = useState(() => resolveMode(mode))
  useEffect(() => {
    setResolved(resolveMode(mode))
    if (mode !== 'system') return
    const mq = dark()
    const h = () => setResolved(resolveMode('system'))
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [mode])
  return resolved
}

export function useSettings() {
  const [s, setS] = useState<Settings>(loadSettings)
  useEffect(() => {
    applySettings(s)
    try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* sin almacenamiento */ }
    if (s.mode !== 'system') return
    const mq = dark(); const h = () => applySettings(s)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [s])
  return [s, (p: Partial<Settings>) => setS((o) => ({ ...o, ...p }))] as const
}
