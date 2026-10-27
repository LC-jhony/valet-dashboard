import { describe, expect, it } from 'vitest'
import { contrastRatio, luminance, onAccent, PALETTES } from './theme'

const accents = Object.values(PALETTES).flatMap((p) => [p.light.accent, p.dark.accent])

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
