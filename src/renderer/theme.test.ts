import { describe, expect, it } from 'vitest'
import { contrastRatio, deriveInks, luminance, mix, onAccent, over, PALETTES, readableOn } from './theme'

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

  it('no toca los temas cuyo acento ya admite texto blanco', () => {
    expect(PALETTES.min.light.accentFill).toBeUndefined()
    expect(onAccent(PALETTES.min.light.accent)).toBe('#FFFFFF')
  })

  it('da un relleno oscuro al azul claro de Min para que el texto sea blanco', () => {
    expect(PALETTES.min.dark.accentFill).toBe('#0E639C')
    expect(onAccent(PALETTES.min.dark.accentFill!)).toBe('#FFFFFF')
    expect(luminance(PALETTES.min.dark.accentFill!)).toBeLessThan(luminance(PALETTES.min.dark.accent))
  })
})

/** Fondos reales de la hoja de estilos sobre los que se pinta texto de color. */
const surfaces = (c: (typeof PALETTES)[keyof typeof PALETTES]['dark']) => ({
  accent: [
    c.panel, c.bg, c.nav,
    over(c.accent, c.panel, 0.13), over(c.accent, c.bg, 0.13), over(c.accent, c.nav, 0.11)
  ],
  warn: [
    c.panel, c.bg, c.nav,
    over(c.warn, c.panel, 0.15), over(c.warn, c.bg, 0.15), over(c.warn, c.nav, 0.15)
  ],
  ok: [c.panel, c.bg, over(c.ok, c.panel, 0.12), over(c.ok, c.bg, 0.12)],
  muted: [
    c.panel, c.bg, mix(c.panel, c.bg, 0.4),
    over(c.ink, c.panel, 0.06), over(c.ink, c.bg, 0.06), over(c.ink, c.panel, 0.1)
  ],
  navMuted: [c.nav, over(c.navInk, c.nav, 0.09)]
})

describe('tonos de texto derivados', () => {
  it('llegan a AA sobre todos los fondos de cada tema', () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      for (const mode of ['dark', 'light'] as const) {
        const c = palette[mode]
        const inks = deriveInks(c)
        const bgs = surfaces(c)
        for (const key of ['accent', 'warn', 'ok', 'muted', 'navMuted'] as const) {
          for (const bg of bgs[key]) {
            const ratio = contrastRatio(luminance(inks[key]), luminance(bg))
            expect(ratio, `${name} ${mode} ${key} ${inks[key]} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    }
  })

  it('aclara en oscuro y oscurece en claro sin cambiar el tono del acento', () => {
    for (const palette of Object.values(PALETTES)) {
      const dark = deriveInks(palette.dark)
      const light = deriveInks(palette.light)
      expect(luminance(dark.accent)).toBeGreaterThanOrEqual(luminance(palette.dark.accent))
      expect(luminance(light.accent)).toBeLessThanOrEqual(luminance(palette.light.accent))
    }
    // El rojo de Carbon claro conserva su matiz: sigue siendo rojo, no granate.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(deriveInks(PALETTES.carbon.light).accent.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(g + 80)
    expect(r).toBeGreaterThan(b + 80)
  })

  it('no cambia los colores que ya cumplían', () => {
    const carbonDark = PALETTES.carbon.dark
    expect(deriveInks(carbonDark).warn).toBe(carbonDark.warn)
    expect(deriveInks(carbonDark).ok).toBe(carbonDark.ok)
    expect(deriveInks(carbonDark).navMuted).toBe(carbonDark.navMuted)
    expect(deriveInks(PALETTES.carbon.light).muted).toBe(PALETTES.carbon.light.muted)
  })

  it('devuelve el mismo color cuando el contraste ya basta', () => {
    expect(readableOn('#FFFFFF', ['#111111'], false)).toBe('#FFFFFF')
    expect(readableOn('#111111', ['#FFFFFF'], true)).toBe('#111111')
  })

  it('corrige los grises que se quedaban cortos en el tema Min', () => {
    expect(deriveInks(PALETTES.min.dark).muted).not.toBe(PALETTES.min.dark.muted)
    expect(deriveInks(PALETTES.min.light).muted).not.toBe(PALETTES.min.light.muted)
    expect(deriveInks(PALETTES.min.light).navMuted).not.toBe(PALETTES.min.light.navMuted)
  })
})
