import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const REPO_PATH_FLAG = '--repo-path='
const PURPOSE_FLAG = '--purpose='

const repoPathArg = process.argv.find(a => a.startsWith(REPO_PATH_FLAG))
const repoPath = repoPathArg ? repoPathArg.slice(REPO_PATH_FLAG.length) : process.cwd()
const purposeArg = process.argv.find(a => a.startsWith(PURPOSE_FLAG))
const purpose: 'inbox' | 'local' = purposeArg === '--purpose=inbox' ? 'inbox' : 'local'

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

export type AuthStatus =
  | { kind: 'authenticated'; user: string }
  | { kind: 'not-authenticated' }
  | { kind: 'gh-not-installed' }
  | { kind: 'error'; message: string }

export interface PullRequestSummary {
  id: number
  number: number
  title: string
  repo: string
  author: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  url: string
  updatedAt: string
  commentCount: number
}

export interface InboxResult {
  mine: PullRequestSummary[]
  reviewRequested: PullRequestSummary[]
  recentlyMerged: PullRequestSummary[]
}

const api = {
  repoPath,
  purpose,
  getLocalDiff: (path: string): Promise<LocalDiffResult> => ipcRenderer.invoke('git:local-diff', path),
  reviewGet: (key: ReviewKey): Promise<PendingReview | null> => ipcRenderer.invoke('review:get', key),
  reviewUpsert: (review: PendingReview): Promise<void> => ipcRenderer.invoke('review:upsert', review),
  reviewDelete: (key: ReviewKey): Promise<void> => ipcRenderer.invoke('review:delete', key),
  reviewSubmitToAgent: (review: PendingReview): Promise<void> =>
    ipcRenderer.invoke('review:submit-to-agent', review),
  ghAuthStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('gh:auth-status'),
  githubListPRs: (): Promise<InboxResult> => ipcRenderer.invoke('github:list-prs'),
  openPRReview: (args: { owner: string; repo: string; number: number }): Promise<void> =>
    ipcRenderer.invoke('window:open-pr-review', args)
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
