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

interface Colors { bg: string; panel: string; ink: string; muted: string; line: string; accent: string; warn: string; ok: string; nav: string; navInk: string; navMuted: string }

/** Colores tomados de los temas de VS Code incluidos en ./themes (Carbon y Min). */
export const PALETTES: Record<PaletteId, { name: string; light: Colors; dark: Colors }> = {
  carbon: {
    name: 'Carbon',
    dark: { bg: '#171717', panel: '#1E1E1E', ink: '#C9CCCD', muted: '#8993A4', line: '#2A2A2A', accent: '#FF4262', warn: '#E8A33D', ok: '#57A464', nav: '#171717', navInk: '#C9CCCD', navMuted: '#8993A4' },
    light: { bg: '#FFFFFF', panel: '#F8FAFC', ink: '#2C3E50', muted: '#4A5568', line: '#E2E8F0', accent: '#FF4262', warn: '#B7791F', ok: '#276749', nav: '#F1F5F9', navInk: '#2C3E50', navMuted: '#4A5568' }
  },
  min: {
    name: 'Min',
    dark: { bg: '#1F1F1F', panel: '#262626', ink: '#E0E0E0', muted: '#939393', line: '#363636', accent: '#79B8FF', warn: '#F97583', ok: '#7BC47F', nav: '#1A1A1A', navInk: '#C1C1C1', navMuted: '#7D7D7D' },
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
  const vars: Record<string, string> = {
    bg: c.bg, panel: c.panel, ink: c.ink, muted: c.muted, line: c.line, accent: c.accent, warn: c.warn, ok: c.ok,
    nav: c.nav, 'nav-ink': c.navInk, 'nav-muted': c.navMuted, 'on-accent': onAccent(c.accent),
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
