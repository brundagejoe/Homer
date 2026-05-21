import { app, BrowserWindow, shell } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { join, resolve } from 'node:path'
import { registerIpcHandlers } from './ipc'

const REPO_FLAG = '--repo-path='
const PURPOSE_FLAG = '--purpose='

type LaunchTarget =
  | { kind: 'inbox' }
  | { kind: 'local'; repoPath: string }

function resolveLaunchTarget(argv: string[]): LaunchTarget {
  const explicit = argv.find(a => a.startsWith(REPO_FLAG))
  if (explicit) return { kind: 'local', repoPath: explicit.slice(REPO_FLAG.length) }
  const positional = argv.slice(2).find(a => !a.startsWith('-') && !a.includes('app.asar'))
  if (positional) return { kind: 'local', repoPath: resolve(positional) }
  return { kind: 'inbox' }
}

let inboxWindow: BrowserWindow | null = null
const localWindows = new Map<string, BrowserWindow>()

function openWindow(target: LaunchTarget): void {
  if (target.kind === 'inbox') {
    if (inboxWindow && !inboxWindow.isDestroyed()) {
      if (inboxWindow.isMinimized()) inboxWindow.restore()
      inboxWindow.focus()
      return
    }
  } else {
    const existing = localWindows.get(target.repoPath)
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
      return
    }
  }

  const additionalArguments =
    target.kind === 'inbox'
      ? [`${PURPOSE_FLAG}inbox`]
      : [`${PURPOSE_FLAG}local`, `${REPO_FLAG}${target.repoPath}`]

  const title =
    target.kind === 'inbox' ? 'Diff Viewer — Inbox' : `Diff Viewer — ${target.repoPath}`

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      additionalArguments
    }
  })

  if (target.kind === 'inbox') {
    inboxWindow = win
    win.on('closed', () => {
      if (inboxWindow === win) inboxWindow = null
    })
  } else {
    localWindows.set(target.repoPath, win)
    win.on('closed', () => {
      if (localWindows.get(target.repoPath) === win) localWindows.delete(target.repoPath)
    })
  }

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
    openWindow(resolveLaunchTarget(argv))
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.brundagejoe.diff-viewer')
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()
    openWindow(resolveLaunchTarget(process.argv))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        openWindow(resolveLaunchTarget(process.argv))
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

