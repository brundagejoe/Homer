import { app, BrowserWindow, shell } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { join, resolve } from 'node:path'
import { registerIpcHandlers } from './ipc'

const REPO_FLAG = '--repo-path='

function resolveRepoPathFromArgv(argv: string[]): string {
  const flag = argv.find(a => a.startsWith(REPO_FLAG))
  if (flag) return flag.slice(REPO_FLAG.length)
  const positional = argv.slice(2).find(a => !a.startsWith('-') && !a.includes('app.asar'))
  return positional ? resolve(positional) : process.cwd()
}

const windowsByRepo = new Map<string, BrowserWindow>()

function createWindow(repoPath: string): void {
  const existing = windowsByRepo.get(repoPath)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: `Diff Viewer — ${repoPath}`,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      additionalArguments: [`${REPO_FLAG}${repoPath}`]
    }
  })

  windowsByRepo.set(repoPath, win)
  win.on('closed', () => {
    if (windowsByRepo.get(repoPath) === win) windowsByRepo.delete(repoPath)
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
    createWindow(resolveRepoPathFromArgv(argv))
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.brundagejoe.diff-viewer')
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()
    createWindow(resolveRepoPathFromArgv(process.argv))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(resolveRepoPathFromArgv(process.argv))
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
