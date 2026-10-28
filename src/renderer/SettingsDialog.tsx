import type { ReactNode } from 'react'
import { DEFAULTS, PALETTES, useResolvedMode, type FontKey, type IconThemeId, type Mode, type PaletteId, type Settings } from './theme'
import { ICON_THEMES, iconUrl } from './icons'
import { Glyph } from './ui-icons'
import { Modal } from './Modal'

function Seg<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: [T, ReactNode][]; onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  )
}

export function SettingsDialog({ s, set, onClose }: { s: Settings; set: (p: Partial<Settings>) => void; onClose: () => void }) {
  const mode = useResolvedMode(s.mode)
  const swatch = (p: PaletteId) => (
    <>
      <i className="dot" style={{ background: PALETTES[p][mode].bg, borderColor: PALETTES[p][mode].line }} />
      <i className="dot" style={{ background: PALETTES[p][mode].accent }} />
      {PALETTES[p].name}
    </>
  )
  return (
    <Modal labelledBy="st-title" onClose={onClose}>
      <header className="page-head">
        <h1 id="st-title">Settings</h1>
        <button className="btn ghost" onClick={onClose} aria-label="Close settings">
          <Glyph name="close" size={13} />Close
        </button>
      </header>

      <div className="field"><span>Theme</span>
        <Seg<Mode> label="Theme" value={s.mode} onChange={(mode) => set({ mode })}
          options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} /></div>

      <div className="field"><span>Palette</span>
        <Seg<PaletteId> label="Palette" value={s.palette} onChange={(palette) => set({ palette })}
          options={[['carbon', swatch('carbon')], ['min', swatch('min')]]} /></div>

      <div className="field"><span>File icons</span>
        <Seg<IconThemeId> label="File icons" value={s.iconTheme} onChange={(iconTheme) => set({ iconTheme })}
          options={ICON_THEMES.map((t) => [
            t.id,
            <span className="icon-opt">
              <img src={iconUrl(t.id, mode, 'folder_home_open')} width={16} height={16} alt="" />
              {t.name}
            </span>
          ] as [IconThemeId, ReactNode])} />
        <small className="field-note">Used in navigation, sites, services and states.</small>
      </div>

      <div className="field"><span>Font</span>
        <Seg<FontKey> label="Font" value={s.font} onChange={(font) => set({ font })}
          options={[['system', 'System'], ['mono', 'Monospace'], ['serif', 'Serif'], ['custom', 'Other']]} />
        {s.font === 'custom' && (
          <input placeholder="Name of an installed font, e.g. Fira Sans" value={s.customFont}
            onChange={(e) => set({ customFont: e.target.value })} />
        )}
      </div>

      <div className="field"><span>Text size: {s.fontSize}px</span>
        <input type="range" min={12} max={20} value={s.fontSize} aria-label="Text size" onChange={(e) => set({ fontSize: Number(e.target.value) })} />
      </div>

      <label className="check"><input type="checkbox" checked={s.compact} onChange={(e) => set({ compact: e.target.checked })} />Compact view</label>

      <footer><button className="btn" onClick={() => set(DEFAULTS)}>Reset</button></footer>
    </Modal>
  )
}
