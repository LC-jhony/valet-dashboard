import { contextBridge, ipcRenderer } from 'electron'
import type { Api, CreateProjectEvent, InstallEvent } from '../shared/types'
import type { MailpitEvent } from '../shared/mailpit'

const call = (ch: string, ...a: unknown[]) => ipcRenderer.invoke(ch, ...a)

const api: Api = {
  sites: {
    list: () => call('sites:list'),
    secure: (n, on) => call('sites:secure', n, on),
    open: (n) => call('sites:open', n),
    projectInfo: () => call('sites:project-info'),
    pickDirectory: (current) => call('sites:pick-dir', current),
    create: (o) => call('sites:create', o),
    onCreateEvent: (cb) => {
      const h = (_e: unknown, ev: CreateProjectEvent) => cb(ev)
      ipcRenderer.on('sites:create-event', h)
      return () => void ipcRenderer.removeListener('sites:create-event', h)
    }
  },
  php: { list: () => call('php:list'), use: (v) => call('php:use', v) },
  ports: {
    scan: () => call('ports:scan'),
    set: (h, s) => call('ports:set', h, s),
    setApache: (h, s) => call('ports:setApache', h, s)
  },
  services: { list: () => call('services:list'), action: (n, a) => call('services:action', n, a) },
  mailpit: {
    info: () => call('mailpit:info'),
    config: () => call('mailpit:config'),
    save: (c) => call('mailpit:save', c),
    start: () => call('mailpit:start'),
    stop: () => call('mailpit:stop'),
    restart: () => call('mailpit:restart'),
    install: () => call('mailpit:install'),
    useSystem: (p) => call('mailpit:useSystem', p),
    uninstall: (d) => call('mailpit:uninstall', d),
    logs: (n) => call('mailpit:logs', n),
    clearMessages: () => call('mailpit:clearMessages'),
    sendTest: (to) => call('mailpit:sendTest', to),
    openExternal: () => call('mailpit:openExternal'),
    auxiliary: () => call('mailpit:auxiliary'),
    writeAuxiliary: (k, c) => call('mailpit:writeAuxiliary', k, c),
    configureEnv: (s) => call('mailpit:configureEnv', s),
    sendmailInfo: () => call('mailpit:sendmailInfo'),
    setPhpSendmail: (v, e) => call('mailpit:setPhpSendmail', v, e),
    testPhpMail: (v, to) => call('mailpit:testPhpMail', v, to),
    setBounds: (rect, visible) => ipcRenderer.send('mailpit:view', rect, visible),
    onEvent: (cb) => {
      const h = (_e: unknown, ev: MailpitEvent) => cb(ev)
      ipcRenderer.on('mailpit:event', h)
      return () => void ipcRenderer.removeListener('mailpit:event', h)
    },
    onShortcut: (cb) => {
      const h = (_e: unknown, key: string) => cb(key)
      ipcRenderer.on('mailpit:shortcut', h)
      return () => void ipcRenderer.removeListener('mailpit:shortcut', h)
    }
  },
  install: {
    check: () => call('install:check'),
    start: (o) => call('install:start', o),
    uninstall: (p) => call('install:uninstall', p),
    repairDns: (m) => call('install:repairDns', m),
    syncHosts: () => call('install:syncHosts'),
    onEvent: (cb) => {
      const h = (_e: unknown, ev: InstallEvent) => cb(ev)
      ipcRenderer.on('install:event', h)
      return () => void ipcRenderer.removeListener('install:event', h)
    }
  }
}
contextBridge.exposeInMainWorld('api', api)
