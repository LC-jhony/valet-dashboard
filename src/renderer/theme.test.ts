import { describe, expect, it } from 'vitest'
import { contrastRatio, luminance, onAccent, PALETTES } from './theme'

const accents = Object.values(PALETTES).flatMap((p) => [p.light.accent, p.dark.accent])
const themes = Object.values(PALETTES).flatMap((p) => [p.light, p.dark])
const fills = themes.map((c) => c.accentFill ?? c.accent)

describe('onAccent', () => {
  it('elige el color de texto con más contraste para cada acento', () => {
    for (const accent of accents) {
      const ink = onAccent(accent)
      const ratio = contrastRatio(luminance(accent), luminance(ink))
      const other = contrastRatio(luminance(accent), luminance(ink === '#111111' ? '#FFFFFF' : '#111111'))
      expect(ratio).toBeGreaterThanOrEqual(other)
      // AA para texto normal.
      expect(ratio, `${accent} con ${ink}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('mantiene texto oscuro sobre el rojo de Carbon y claro sobre el azul de Min oscuro', () => {
    expect(onAccent(PALETTES.carbon.dark.accent)).toBe('#111111')
    expect(onAccent('#111111')).toBe('#FFFFFF')
    expect(onAccent('#FFFFFF')).toBe('#111111')
  })
})

describe('relleno de los controles primarios', () => {
  it('lleva texto blanco con contraste AA en todos los temas', () => {
    for (const [i, fill] of fills.entries()) {
      const ink = onAccent(fill)
      const ratio = contrastRatio(luminance(fill), luminance(ink))
      expect(ratio, `${fill} con ${ink}`).toBeGreaterThanOrEqual(4.5)
      if (themes[i].accentFill) expect(ink, `${fill} con ${ink}`).toBe('#FFFFFF')
    }
  })

  it('oscurece el rojo de Carbon sin cambiar el acento de iconos y bordes', () => {
    const carbon = PALETTES.carbon.dark
    expect(carbon.accent).toBe('#FF4262')
    expect(carbon.accentFill).toBe('#E11D48')
    expect(luminance(carbon.accentFill!)).toBeLessThan(luminance(carbon.accent))
  })

  it('no toca los temas que ya tenían un relleno legible', () => {
    expect(PALETTES.min.dark.accentFill).toBeUndefined()
    expect(PALETTES.min.light.accentFill).toBeUndefined()
    expect(onAccent(PALETTES.min.dark.accent)).toBe('#111111')
    expect(onAccent(PALETTES.min.light.accent)).toBe('#FFFFFF')
  })
})
