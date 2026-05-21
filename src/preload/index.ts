import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const REPO_PATH_FLAG = '--repo-path='
const repoPathArg = process.argv.find(a => a.startsWith(REPO_PATH_FLAG))
const repoPath = repoPathArg ? repoPathArg.slice(REPO_PATH_FLAG.length) : process.cwd()

const api = {
  repoPath,
  getLocalPatch: (path: string): Promise<string> =>
    ipcRenderer.invoke('git:local-patch', path)
}

export type DiffViewerApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
