import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const REPO_PATH_FLAG = '--repo-path='
const repoPathArg = process.argv.find(a => a.startsWith(REPO_PATH_FLAG))
const repoPath = repoPathArg ? repoPathArg.slice(REPO_PATH_FLAG.length) : process.cwd()

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface FileWithPatch {
  path: string
  oldPath?: string
  status: FileStatus
  isBinary: boolean
  patch: string
}

export interface LocalDiffResult {
  files: FileWithPatch[]
}

export interface DiffSourceSpec {
  type: 'working-tree-vs-head'
}

export interface LineComment {
  id: string
  path: string
  lineNumber: number
  side: 'old' | 'new'
  body: string
}

export interface DiffSnapshot {
  files: FileWithPatch[]
}

export interface PendingReview {
  repoPath: string
  sourceSpec: DiffSourceSpec
  snapshot: DiffSnapshot
  lineComments: LineComment[]
  summary: string
  createdAt: number
  updatedAt: number
}

export interface ReviewKey {
  repoPath: string
  sourceSpec: DiffSourceSpec
}

const api = {
  repoPath,
  getLocalDiff: (path: string): Promise<LocalDiffResult> => ipcRenderer.invoke('git:local-diff', path),
  reviewGet: (key: ReviewKey): Promise<PendingReview | null> => ipcRenderer.invoke('review:get', key),
  reviewUpsert: (review: PendingReview): Promise<void> => ipcRenderer.invoke('review:upsert', review),
  reviewDelete: (key: ReviewKey): Promise<void> => ipcRenderer.invoke('review:delete', key),
  reviewSubmitToAgent: (review: PendingReview): Promise<void> =>
    ipcRenderer.invoke('review:submit-to-agent', review)
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
