import { app, BrowserWindow, ipcMain, Menu, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as v from './valet'
import * as inst from './install'

app.setName('Valet Dashboard')
const ICON_PATH = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(__dirname, '../../resources/icon.png')
const ICON = existsSync(ICON_PATH) ? nativeImage.createFromPath(ICON_PATH) : null

const handlers: Record<string, (...a: any[]) => Promise<unknown>> = {
  'sites:list': v.listSites,
  'sites:secure': v.setSecure,
  'php:list': v.phpInfo,
  'php:use': v.usePhp,
  'ports:scan': v.scanPorts,
  'ports:set': v.setPorts,
  'ports:setApache': v.setApachePorts,
  'services:list': v.listServices,
  'services:action': v.serviceAction
}
for (const [ch, fn] of Object.entries(handlers)) ipcMain.handle(ch, (_e, ...args) => fn(...args))

ipcMain.handle('install:check', inst.checkEnv)
ipcMain.handle('install:start', (e, o) => inst.startInstall(o, (ev) => e.sender.send('install:event', ev)))
ipcMain.handle('install:uninstall', (e, p) => inst.startUninstall(p, (ev) => e.sender.send('install:event', ev)))

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 720, minWidth: 760, minHeight: 520,
    autoHideMenuBar: true,
    icon: ICON && !ICON.isEmpty() ? ICON : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  })
  if (ICON && !ICON.isEmpty()) win.setIcon(ICON)
  win.removeMenu()
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
})
app.on('window-all-closed', () => app.quit())
