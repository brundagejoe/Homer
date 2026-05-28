import { app, BrowserWindow, shell } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { join, resolve } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { parsePrUrl } from './pr-url'
import { GitDiffProvider } from './git-diff-provider'
import { WindowStateStore } from './window-state-store'

const REPO_FLAG = '--repo-path='
const PR_FLAG = '--pr='
const PURPOSE_FLAG = '--purpose='
const LAUNCH_REPO_FLAG = '--launch-repo='

/** The route a launch resolves to — where the (single) window starts. */
type LaunchRoute =
  | { kind: 'inbox' }
  | { kind: 'local'; repoPath: string }
  | { kind: 'pr-review'; owner: string; repo: string; number: number }

/** Renderer-facing navigation event shape (matches NavRoute in preload). */
type NavRoute =
  | { kind: 'inbox' }
  | { kind: 'local'; repoPath: string }
  | { kind: 'pr'; target: { owner: string; repo: string; number: number } }

/**
 * A launch resolves to a starting route plus the local repo (if any)
 * the window was opened from. `repoPath` lets the inbox offer a jump
 * back to that repo's local changes even when we start on the inbox.
 */
interface Launch {
  route: LaunchRoute
  repoPath: string | null
}

const provider = new GitDiffProvider()

/**
 * Decide where a launch lands. A PR URL/flag opens that PR. A repo path
 * (explicit flag or positional) opens its Code view *only if it has
 * active changes*; a clean repo falls back to the inbox. With nothing,
 * the inbox.
 */
async function resolveLaunch(argv: string[]): Promise<Launch> {
  const prFlag = argv.find(a => a.startsWith(PR_FLAG))
  if (prFlag) {
    const [owner, repo, numStr] = prFlag.slice(PR_FLAG.length).split('/')
    return { route: { kind: 'pr-review', owner, repo, number: Number(numStr) }, repoPath: null }
  }

  let repoPath: string | null = null
  const explicit = argv.find(a => a.startsWith(REPO_FLAG))
  if (explicit) {
    repoPath = explicit.slice(REPO_FLAG.length)
  } else {
    const positional = argv.slice(2).find(a => !a.startsWith('-') && !a.includes('app.asar'))
    if (positional) {
      const fromUrl = parsePrUrl(positional)
      if (fromUrl) return { route: { kind: 'pr-review', ...fromUrl }, repoPath: null }
      repoPath = resolve(positional)
    }
  }

  if (repoPath && (await provider.hasChanges(repoPath))) {
    return { route: { kind: 'local', repoPath }, repoPath }
  }
  return { route: { kind: 'inbox' }, repoPath: null }
}

function toNavRoute(route: LaunchRoute): NavRoute {
  switch (route.kind) {
    case 'inbox':
      return { kind: 'inbox' }
    case 'local':
      return { kind: 'local', repoPath: route.repoPath }
    case 'pr-review':
      return { kind: 'pr', target: { owner: route.owner, repo: route.repo, number: route.number } }
  }
}

function buildLaunchArgs(launch: Launch): string[] {
  const args: string[] = []
  switch (launch.route.kind) {
    case 'inbox':
      args.push(`${PURPOSE_FLAG}inbox`)
      break
    case 'local':
      args.push(`${PURPOSE_FLAG}local`, `${REPO_FLAG}${launch.route.repoPath}`)
      break
    case 'pr-review':
      args.push(
        `${PURPOSE_FLAG}pr-review`,
        `${PR_FLAG}${launch.route.owner}/${launch.route.repo}/${launch.route.number}`
      )
      break
  }
  if (launch.repoPath) args.push(`${LAUNCH_REPO_FLAG}${launch.repoPath}`)
  return args
}

/**
 * The app owns exactly one window (ADR 0003). Navigation between the
 * inbox, a PR, and local changes happens inside it.
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
 * navigate it to the launch's route in place.
 */
async function openOrNavigate(argv: string[]): Promise<void> {
  const launch = await resolveLaunch(argv)

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    mainWindow.webContents.send('app:navigate', toNavRoute(launch.route))
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
    title: 'Diff Viewer',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      additionalArguments: buildLaunchArgs(launch)
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
    void openOrNavigate(argv)
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.brundagejoe.diff-viewer')
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()
    void openOrNavigate(process.argv)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void openOrNavigate(process.argv)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
