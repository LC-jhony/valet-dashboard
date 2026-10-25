import { contextBridge, ipcRenderer } from 'electron'
import type { Api, InstallEvent } from '../shared/types'

const call = (ch: string, ...a: unknown[]) => ipcRenderer.invoke(ch, ...a)

const api: Api = {
  sites: { list: () => call('sites:list'), secure: (n, on) => call('sites:secure', n, on) },
  php: { list: () => call('php:list'), use: (v) => call('php:use', v) },
  ports: {
    scan: () => call('ports:scan'),
    set: (h, s) => call('ports:set', h, s),
    setApache: (h, s) => call('ports:setApache', h, s)
  },
  services: { list: () => call('services:list'), action: (n, a) => call('services:action', n, a) },
  install: {
    check: () => call('install:check'),
    start: (o) => call('install:start', o),
    uninstall: (p) => call('install:uninstall', p),
    onEvent: (cb) => {
      const h = (_e: unknown, ev: InstallEvent) => cb(ev)
      ipcRenderer.on('install:event', h)
      return () => void ipcRenderer.removeListener('install:event', h)
    }
  }
}
contextBridge.exposeInMainWorld('api', api)
