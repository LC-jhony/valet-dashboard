import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAppUrl } from './window-guard'

const RENDERER_DIR = '/home/ana/valet-dashboard/out/renderer'
const prod = { devUrl: '', rendererDir: RENDERER_DIR }
const fileUrl = (p: string) => pathToFileURL(p).href

describe('isAppUrl: build de producción', () => {
  it('acepta el index.html del renderer', () => {
    expect(isAppUrl(fileUrl(join(RENDERER_DIR, 'index.html')), prod)).toBe(true)
  })

  it('acepta un asset dentro del renderer', () => {
    expect(isAppUrl(fileUrl(join(RENDERER_DIR, 'assets', 'index.js')), prod)).toBe(true)
  })

  it('rechaza un archivo hermano que solo comparte el prefijo del nombre', () => {
    // Sin separador de por medio, «renderer-evil» no está dentro de «renderer».
    expect(isAppUrl(fileUrl('/home/ana/valet-dashboard/out/renderer-evil/x.html'), prod)).toBe(false)
  })

  it('rechaza el escape con ..', () => {
    expect(isAppUrl(fileUrl(join(RENDERER_DIR, '..', '..', '..', 'etc', 'passwd')), prod)).toBe(false)
  })

  it('rechaza el escape con .. codificado', () => {
    expect(isAppUrl(`file://${RENDERER_DIR}/%2e%2e/%2e%2e/%2e%2e/etc/passwd`, prod)).toBe(false)
  })

  it('rechaza http aunque el host sea local', () => {
    expect(isAppUrl('http://localhost/index.html', prod)).toBe(false)
  })

  it('rechaza esquemas ejecutables', () => {
    expect(isAppUrl('javascript:alert(1)', prod)).toBe(false)
    expect(isAppUrl('data:text/html,<h1>x</h1>', prod)).toBe(false)
  })

  it('rechaza una URL inválida sin lanzar', () => {
    expect(isAppUrl('no es una url', prod)).toBe(false)
    expect(isAppUrl('', prod)).toBe(false)
  })
})

describe('isAppUrl: servidor de desarrollo', () => {
  const dev = { devUrl: 'http://localhost:5173/', rendererDir: RENDERER_DIR }

  it('acepta el mismo origen en cualquier ruta', () => {
    expect(isAppUrl('http://localhost:5173/', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5173/src/main.tsx', dev)).toBe(true)
  })

  it('rechaza otro puerto y otro host', () => {
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isAppUrl('http://127.0.0.1:5173/', dev)).toBe(false)
    expect(isAppUrl('https://localhost:5173/', dev)).toBe(false)
  })

  it('rechaza file: cuando hay servidor de desarrollo', () => {
    expect(isAppUrl(fileUrl(join(RENDERER_DIR, 'index.html')), dev)).toBe(false)
  })
})
