import {
  app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell,
  WebContentsView, type OpenDialogOptions
} from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as v from './valet'
import * as inst from './install'
import * as mp from './mailpit'
import * as mpc from './mailpit-config'
import * as mpp from './mailpit-project'
import { isAppUrl as isAppUrlIn } from './window-guard'

app.setName('Valet Dashboard')
const ICON_PATH = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(__dirname, '../../resources/icon.png')
const ICON = existsSync(ICON_PATH) ? nativeImage.createFromPath(ICON_PATH) : null

const handlers: Record<string, (...a: any[]) => Promise<unknown>> = {
  'sites:list': v.listSites,
  'sites:secure': v.setSecure,
  'sites:open': async (name: string) => { await shell.openExternal(await v.siteUrl(name)) },
  'sites:project-info': v.projectInfo,
  'php:list': v.phpInfo,
  'php:use': v.usePhp,
  'ports:scan': v.scanPorts,
  'ports:set': v.setPorts,
  'ports:setApache': v.setApachePorts,
  'services:list': v.listServices,
  'services:action': v.serviceAction,
  'mailpit:info': mp.getInfo,
  'mailpit:config': mpc.loadConfig,
  'mailpit:save': mp.save,
  'mailpit:start': mp.start,
  'mailpit:stop': mp.stop,
  'mailpit:restart': mp.restart,
  'mailpit:useSystem': mp.useSystem,
  'mailpit:uninstall': mp.uninstall,
  'mailpit:logs': mp.logs,
  'mailpit:clearMessages': mp.clearMessages,
  'mailpit:sendTest': mp.sendTest,
  'mailpit:openExternal': mp.openExternal,
  'mailpit:auxiliary': mp.auxiliary,
  'mailpit:writeAuxiliary': mp.writeAuxiliary,
  'mailpit:configureEnv': mpp.configureEnv,
  'mailpit:sendmailInfo': mpp.sendmailInfo,
  'mailpit:setPhpSendmail': mpp.setPhpSendmail,
  'mailpit:testPhpMail': mpp.testPhpMail
}

// ── Frontera renderer → main ─────────────────────────────────────────────────
// Solo la ventana principal puede llamar al IPC: el preload vive en su
// webContents, así que cualquier otra página (o un invitado inesperado) queda
// fuera aunque consiguiera ejecutar JavaScript.
let mainWindow: BrowserWindow | null = null

const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL ?? ''
const RENDERER_DIR = join(__dirname, '../renderer')

/** ¿Es una URL de la propia aplicación (renderer de desarrollo o build)? */
const isAppUrl = (url: string): boolean =>
  isAppUrlIn(url, { devUrl: RENDERER_DEV_URL, rendererDir: RENDERER_DIR })

function trustedSender(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (e.sender !== mainWindow.webContents) return false
  const frame = e.senderFrame
  return !frame || isAppUrl(frame.url)
}

function assertTrusted(e: Electron.IpcMainInvokeEvent): void {
  if (!trustedSender(e)) throw new Error('Origen no autorizado')
}

for (const [ch, fn] of Object.entries(handlers)) {
  ipcMain.handle(ch, (e, ...args) => {
    assertTrusted(e)
    if (ch.startsWith('mailpit:') && ch !== 'mailpit:info' && ch !== 'mailpit:config') invalidateMailTarget()
    return fn(...args)
  })
}

ipcMain.handle('sites:pick-dir', async (e, current?: string) => {
  assertTrusted(e)
  const win = BrowserWindow.fromWebContents(e.sender)
  const options: OpenDialogOptions = {
    title: 'Elegir carpeta para el proyecto',
    defaultPath: typeof current === 'string' && current.trim() ? current : undefined,
    properties: ['openDirectory', 'createDirectory']
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] ?? null
})

/** Canal con progreso: valida el emisor y emite por el canal de eventos indicado. */
function handleWithEvents(
  channel: string,
  eventChannel: string,
  run: (send: (ev: unknown) => void, ...args: any[]) => unknown
) {
  ipcMain.handle(channel, (e, ...args) => {
    assertTrusted(e)
    const send = (ev: unknown) => { if (!e.sender.isDestroyed()) e.sender.send(eventChannel, ev) }
    return run(send, ...args)
  })
}

handleWithEvents('sites:create', 'sites:create-event', (send, o) => v.createLaravelProject(o, send))
ipcMain.handle('install:check', (e) => { assertTrusted(e); return inst.checkEnv() })
handleWithEvents('install:start', 'install:event', (send, o) => inst.startInstall(o, send))
ipcMain.handle('install:cancel', (e) => { assertTrusted(e); inst.cancelInstall() })
handleWithEvents('install:uninstall', 'install:event', (send, p) => inst.startUninstall(p, send))
handleWithEvents('install:repairDns', 'install:event', (send, m) => inst.repairDns(m, send))
handleWithEvents('install:syncHosts', 'install:event', (send) => inst.syncHosts(send))

handleWithEvents('mailpit:install', 'mailpit:event', (send) => { invalidateMailTarget(); return mp.install(send) })

// ── Vista embebida de Mailpit ────────────────────────────────────────────────
let mailView: WebContentsView | null = null
let mailWindow: BrowserWindow | null = null
let mailOrigin = ''
let mailFailed = false
// Última URL pedida a la vista. No se compara con webContents.getURL(): Electron
// normaliza "http://host:port" a "http://host:port/" y esa diferencia recargaba
// la interfaz de Mailpit en cada actualización de geometría.
let mailLoadedUrl = ''
let mailRetry: ReturnType<typeof setTimeout> | null = null

// Carga la URL en la vista y, si falla (Mailpit arrancando, puerto cerrado),
// reintenta por su cuenta: el renderer solo envía geometría cuando cambia.
function loadMailUrl(view: WebContentsView, target: string) {
  mailFailed = false
  mailLoadedUrl = target
  view.webContents.loadURL(target).catch(() => {
    mailFailed = true
    if (mailRetry) return
    mailRetry = setTimeout(() => {
      mailRetry = null
      if (!mailView || !mailFailed || !mailLoadedUrl || mailView.getBounds().width < 2) return
      loadMailUrl(mailView, mailLoadedUrl)
    }, 2000)
  })
}

function isMailUrl(url: string): boolean {
  try { return new URL(url).origin === mailOrigin } catch { return false }
}

function ensureMailView(win: BrowserWindow): WebContentsView {
  if (mailView && mailWindow === win) return mailView
  mailWindow = win
  mailLoadedUrl = ''
  if (mailRetry) { clearTimeout(mailRetry); mailRetry = null }
  mailView = new WebContentsView({
    webPreferences: {
      partition: 'persist:mailpit',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  mailView.setBackgroundColor('#ffffff')
  mailView.setVisible(false)
  win.contentView.addChildView(mailView)

  const wc = mailView.webContents
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const blockExternal = (e: Electron.Event, url: string) => {
    if (isMailUrl(url)) return
    e.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  }
  wc.on('will-navigate', blockExternal)
  wc.on('will-redirect', blockExternal)
  wc.on('did-finish-load', () => { mailFailed = false })
  wc.on('did-fail-load', (_event, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) mailFailed = true
  })
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = input.control || input.meta
    if (!mod) return
    const key = input.key.toLowerCase()
    if (/^[1-6]$/.test(key) || key === 'b' || key === ',') {
      event.preventDefault()
      win.webContents.send('mailpit:shortcut', key)
    }
  })
  return mailView
}

function hideMailView() {
  if (!mailView) return
  if (mailRetry) { clearTimeout(mailRetry); mailRetry = null }
  mailView.setVisible(false)
  mailView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
}

// La URL de la vista la decide el proceso principal a partir de la configuración:
// el renderer solo envía geometría. Así una página cualquiera no puede convertirse
// en el origen al que se entregan las credenciales de Mailpit.
let mailTargetUrl = ''
let mailTargetPromise: Promise<string> | null = null

function invalidateMailTarget() {
  mailTargetUrl = ''
  mailLoadedUrl = ''
}

async function resolveMailTarget(): Promise<string> {
  if (mailTargetUrl) return mailTargetUrl
  if (!mailTargetPromise) {
    mailTargetPromise = mpc.loadConfig()
      .then((c) => {
        const url = mp.uiUrl(c)
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('URL de Mailpit no válida')
        mailOrigin = parsed.origin
        mailTargetUrl = url
        return url
      })
      .catch(() => '')
      .finally(() => { mailTargetPromise = null })
  }
  return mailTargetPromise
}

ipcMain.on('mailpit:view', (e, rect: unknown, visible: unknown) => {
  if (!trustedSender(e)) return
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  if (!visible || !rect || typeof rect !== 'object') { hideMailView(); return }
  const r = rect as Record<string, unknown>
  const nums = [r.x, r.y, r.width, r.height]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) { hideMailView(); return }
  if ((r.width as number) < 2 || (r.height as number) < 2) { hideMailView(); return }
  const view = ensureMailView(win)
  view.setBounds({
    x: Math.round(r.x as number),
    y: Math.round(r.y as number),
    width: Math.round(r.width as number),
    height: Math.round(r.height as number)
  })
  void resolveMailTarget().then((target) => {
    if (!target || mailView !== view) return
    if (target !== mailLoadedUrl || mailFailed) loadMailUrl(view, target)
    view.setVisible(true)
  })
})

// Credenciales para la autenticación básica de Mailpit, solo para el origen de
// Mailpit calculado por el proceso principal.
app.on('login', (event, webContents, details, authInfo, callback) => {
  if (!mailView || webContents !== mailView.webContents || authInfo.isProxy) return
  if (!mailOrigin || !isMailUrl(details.url)) return
  event.preventDefault()
  void mpc.loadConfig().then((c) => {
    if (c.auth.ui.enabled) callback(c.auth.ui.user, c.auth.ui.password)
    else callback()
  }).catch(() => callback())
})

// Acepta únicamente el certificado autofirmado generado por el módulo.
app.on('certificate-error', (event, webContents, url, error, _certificate, callback) => {
  if (!mailView || webContents !== mailView.webContents) return
  if (!mailOrigin || !isMailUrl(url)) { callback(false); return }
  void mpc.loadConfig().then((c) => {
    if (c.tls.enabled && c.tls.selfSigned) {
      event.preventDefault()
      callback(true)
    } else callback(false)
  }).catch(() => callback(false))
})

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
  mainWindow = win
  if (ICON && !ICON.isEmpty()) win.setIcon(ICON)
  win.removeMenu()

  // El preload sigue vivo aunque la ventana navegue, así que la propia ventana
  // no puede salir de la aplicación: cualquier otro destino se abre en el navegador.
  const guard = (e: Electron.Event, url: string) => {
    if (isAppUrl(url)) return
    e.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  }
  win.webContents.on('will-navigate', guard)
  win.webContents.on('will-redirect', guard)
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => {
    hideMailView()
    mailView = null
    mailWindow = null
    if (mainWindow === win) mainWindow = null
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
})
app.on('window-all-closed', () => app.quit())
