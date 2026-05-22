import { app, BrowserWindow, shell } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { join, resolve } from 'node:path'
import { registerIpcHandlers, setOpenWindow } from './ipc'
import { parsePrUrl } from './pr-url'

const REPO_FLAG = '--repo-path='
const PR_FLAG = '--pr='
const PURPOSE_FLAG = '--purpose='

export type LaunchTarget =
  | { kind: 'inbox' }
  | { kind: 'local'; repoPath: string }
  | { kind: 'pr-review'; owner: string; repo: string; number: number }

function resolveLaunchTarget(argv: string[]): LaunchTarget {
  const prFlag = argv.find(a => a.startsWith(PR_FLAG))
  if (prFlag) {
    const [owner, repo, numStr] = prFlag.slice(PR_FLAG.length).split('/')
    return { kind: 'pr-review', owner, repo, number: Number(numStr) }
  }
  const explicit = argv.find(a => a.startsWith(REPO_FLAG))
  if (explicit) return { kind: 'local', repoPath: explicit.slice(REPO_FLAG.length) }
  const positional = argv.slice(2).find(a => !a.startsWith('-') && !a.includes('app.asar'))
  if (positional) {
    const fromUrl = parsePrUrl(positional)
    if (fromUrl) return { kind: 'pr-review', ...fromUrl }
    return { kind: 'local', repoPath: resolve(positional) }
  }
  return { kind: 'inbox' }
}

let inboxWindow: BrowserWindow | null = null
const localWindows = new Map<string, BrowserWindow>()
const prWindows = new Map<string, BrowserWindow>()

function prKey(t: { owner: string; repo: string; number: number }): string {
  return `${t.owner}/${t.repo}/${t.number}`
}

function focusExisting(target: LaunchTarget): boolean {
  if (target.kind === 'inbox') {
    if (inboxWindow && !inboxWindow.isDestroyed()) {
      if (inboxWindow.isMinimized()) inboxWindow.restore()
      inboxWindow.focus()
      return true
    }
  } else if (target.kind === 'local') {
    const w = localWindows.get(target.repoPath)
    if (w && !w.isDestroyed()) {
      if (w.isMinimized()) w.restore()
      w.focus()
      return true
    }
  } else {
    const w = prWindows.get(prKey(target))
    if (w && !w.isDestroyed()) {
      if (w.isMinimized()) w.restore()
      w.focus()
      return true
    }
  }
  return false
}

function openWindow(target: LaunchTarget): void {
  if (focusExisting(target)) return

  let additionalArguments: string[]
  let title: string
  switch (target.kind) {
    case 'inbox':
      additionalArguments = [`${PURPOSE_FLAG}inbox`]
      title = 'Diff Viewer — Inbox'
      break
    case 'local':
      additionalArguments = [`${PURPOSE_FLAG}local`, `${REPO_FLAG}${target.repoPath}`]
      title = `Diff Viewer — ${target.repoPath}`
      break
    case 'pr-review':
      additionalArguments = [
        `${PURPOSE_FLAG}pr-review`,
        `${PR_FLAG}${target.owner}/${target.repo}/${target.number}`
      ]
      title = `Diff Viewer — ${target.owner}/${target.repo}#${target.number}`
      break
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#ffffff',
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
  } else if (target.kind === 'local') {
    localWindows.set(target.repoPath, win)
    win.on('closed', () => {
      if (localWindows.get(target.repoPath) === win) localWindows.delete(target.repoPath)
    })
  } else {
    const key = prKey(target)
    prWindows.set(key, win)
    win.on('closed', () => {
      if (prWindows.get(key) === win) prWindows.delete(key)
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

    setOpenWindow(openWindow)
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
