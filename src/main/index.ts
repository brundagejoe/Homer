import { app, BrowserWindow, shell } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { worktreeManager } from './services'
import { buildLaunchArgs, resolveLaunchTarget, type PrTarget } from './launch'
import { WindowStateStore } from './window-state-store'

/** Product identity. Keep in sync with package.json `productName`/`build.appId`. */
const PRODUCT_NAME = 'Homer'
const APP_ID = 'com.brundagejoe.homer'

/**
 * The app icon lives in `build/` (source SVG + generated raster/icns).
 * On macOS the dock/app icon comes from the packaged `.icns`; this PNG is
 * used for the BrowserWindow on Windows/Linux and for the dock during dev.
 */
const APP_ICON = join(app.getAppPath(), 'build', 'icon.png')

// Set the app name as early as possible so the macOS menu bar, dock, and
// About panel read "Homer" rather than "Electron" (belt-and-suspenders with
// package.json `productName`).
app.setName(PRODUCT_NAME)

/** Renderer-facing navigation event shape (matches NavRoute in preload). */
type NavRoute = { kind: 'pr'; target: PrTarget }

/**
 * The app owns exactly one window (ADR 0003). It always shows one PR's
 * three-tab Window (Activity · Guide · Diff); navigation happens between
 * the tabs inside it.
 */
let mainWindow: BrowserWindow | null = null

let windowStateStoreInstance: WindowStateStore | null = null
function windowStateStore(): WindowStateStore {
  if (!windowStateStoreInstance) {
    windowStateStoreInstance = new WindowStateStore(join(app.getPath('userData'), 'window-state.json'))
  }
  return windowStateStoreInstance
}

/**
 * Debounced bounds-save. Resize/move fire continuously; one disk write
 * per ~250ms quiet period is plenty for "remember on next launch."
 */
function attachBoundsPersistence(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  const persist = () => {
    if (win.isDestroyed()) return
    const b = win.getBounds()
    windowStateStore().save({ width: b.width, height: b.height, x: b.x, y: b.y })
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(persist, 250)
  }
  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    persist()
  })
}

/**
 * Open the single window, or — if it already exists — focus it and
 * navigate it to the launch's PR in place. A launch without a PR URL
 * still opens the window; the renderer shows a "paste a PR URL" state.
 */
function openOrNavigate(argv: string[]): void {
  const target = resolveLaunchTarget(argv)

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    if (target) {
      const nav: NavRoute = { kind: 'pr', target }
      mainWindow.webContents.send('app:navigate', nav)
    }
    return
  }

  const bounds = windowStateStore().get()
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    show: false,
    autoHideMenuBar: true,
    title: PRODUCT_NAME,
    icon: APP_ICON,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      additionalArguments: buildLaunchArgs(target)
    }
  })
  attachBoundsPersistence(win)

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(details => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    openOrNavigate(argv)
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId(APP_ID)

    // De-Electron-ify the About panel (Cmd-click app menu → About Homer).
    app.setAboutPanelOptions({
      applicationName: PRODUCT_NAME,
      applicationVersion: app.getVersion(),
      credits: 'A guided tour of a GitHub PR.'
    })

    // Show the custom icon in the dock during `bun run dev` (packaged builds
    // get it from the bundled .icns). Guarded: dock exists on macOS only.
    if (is.dev && process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(APP_ICON)
    }

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()

    // Startup sweep: clean up PR Worktrees left behind by a crashed session
    // (prune stale registrations + delete orphan folders) before we begin.
    // Awaited so it can't race a first acquire over the shared index.
    await worktreeManager()
      .sweep()
      .catch(err => console.error('PR worktree sweep failed', err))

    openOrNavigate(process.argv)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        openOrNavigate(process.argv)
      }
    })
  })

  // Session-close cleanup: release the PR Worktrees this session materialized.
  app.on('before-quit', event => {
    const mgr = worktreeManager()
    event.preventDefault()
    mgr
      .releaseAll()
      .catch(err => console.error('PR worktree release failed', err))
      .finally(() => app.exit(0))
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
