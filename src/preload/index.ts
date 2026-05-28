import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const REPO_PATH_FLAG = '--repo-path='
const PR_FLAG = '--pr='
const PURPOSE_FLAG = '--purpose='
const LAUNCH_REPO_FLAG = '--launch-repo='

const repoPathArg = process.argv.find(a => a.startsWith(REPO_PATH_FLAG))
const repoPath = repoPathArg ? repoPathArg.slice(REPO_PATH_FLAG.length) : process.cwd()
const purposeArg = process.argv.find(a => a.startsWith(PURPOSE_FLAG))
const purpose: 'inbox' | 'local' | 'pr-review' =
  purposeArg === '--purpose=inbox'
    ? 'inbox'
    : purposeArg === '--purpose=pr-review'
      ? 'pr-review'
      : 'local'
const prFlag = process.argv.find(a => a.startsWith(PR_FLAG))
const prTarget = prFlag
  ? (() => {
      const [owner, repo, num] = prFlag.slice(PR_FLAG.length).split('/')
      return { owner, repo, number: Number(num) }
    })()
  : null
/**
 * The local repo this window was launched from, if any. Lets the inbox
 * offer a jump back to that repo's local changes. Null when launched
 * via a PR URL or with no repo.
 */
const launchRepoArg = process.argv.find(a => a.startsWith(LAUNCH_REPO_FLAG))
const launchRepo = launchRepoArg ? launchRepoArg.slice(LAUNCH_REPO_FLAG.length) : null

/** In-window navigation events pushed by the main process (a second
 *  `dv` invocation focuses this window and navigates it in place). */
export type NavRoute =
  | { kind: 'inbox' }
  | { kind: 'local'; repoPath: string }
  | { kind: 'pr'; target: { owner: string; repo: string; number: number } }

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

export type DiffSourceSpec =
  | { type: 'working-tree-vs-head' }
  | { type: 'staged-vs-head' }
  | { type: 'working-tree-vs-staged' }
  | { type: 'branch-vs-base'; head: string; base: string }
  | { type: 'commit-range'; from: string; to: string }
  | { type: 'single-commit'; sha: string }

export type ReviewTarget =
  | { kind: 'local'; repoPath: string; source: DiffSourceSpec }
  | { kind: 'pr'; owner: string; repo: string; number: number }

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export interface LineComment {
  id: string
  path: string
  /** Last line of the comment's anchor range (or the single line). */
  lineNumber: number
  /** Side for the last line. */
  side: 'old' | 'new'
  /** First line of a multi-line range. Omit for single-line comments. */
  startLineNumber?: number
  /** Side for the first line of a multi-line range. */
  startSide?: 'old' | 'new'
  body: string
  inReplyToId?: number
}

export interface DiffSnapshot {
  files: FileWithPatch[]
}

export interface PendingReview {
  target: ReviewTarget
  snapshot: DiffSnapshot
  lineComments: LineComment[]
  summary: string
  event?: ReviewEvent
  createdAt: number
  updatedAt: number
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

export interface PullRequestDetails {
  owner: string
  repo: string
  number: number
  title: string
  body: string
  author: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  baseRef: string
  headRef: string
  url: string
  commentCount: number
  reviewCommentCount: number
  changedFiles: number
  additions: number
  deletions: number
  updatedAt: string
}

export interface InlineComment {
  id: number
  path: string
  /** Last line of the comment's anchor range (or the single line). */
  lineNumber: number
  /** Side for the last line. */
  side: 'LEFT' | 'RIGHT'
  /** First line of a multi-line range. Omit for single-line comments. */
  startLine?: number
  /** Side for the first line of a multi-line range. */
  startSide?: 'LEFT' | 'RIGHT'
  body: string
  author: string
  createdAt: string
  inReplyToId?: number
}

export interface ConversationComment {
  id: number
  body: string
  author: string
  createdAt: string
}

export interface PrTarget {
  owner: string
  repo: string
  number: number
}

const api = {
  repoPath,
  purpose,
  prTarget,
  launchRepo,
  onNavigate: (cb: (route: NavRoute) => void): (() => void) => {
    const listener = (_e: unknown, route: NavRoute): void => cb(route)
    ipcRenderer.on('app:navigate', listener)
    return () => ipcRenderer.removeListener('app:navigate', listener)
  },
  getLocalDiff: (repoPath: string, source?: DiffSourceSpec): Promise<LocalDiffResult> =>
    ipcRenderer.invoke('git:local-diff', { repoPath, source }),
  reviewGet: (target: ReviewTarget): Promise<PendingReview | null> =>
    ipcRenderer.invoke('review:get', target),
  reviewUpsert: (review: PendingReview): Promise<void> => ipcRenderer.invoke('review:upsert', review),
  reviewDelete: (target: ReviewTarget): Promise<void> => ipcRenderer.invoke('review:delete', target),
  reviewSubmitToAgent: (review: PendingReview): Promise<void> =>
    ipcRenderer.invoke('review:submit-to-agent', review),
  reviewSubmitToGithub: (review: PendingReview): Promise<{ url: string }> =>
    ipcRenderer.invoke('review:submit-to-github', review),
  ghAuthStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('gh:auth-status'),
  githubListPRs: (): Promise<InboxResult> => ipcRenderer.invoke('github:list-prs'),
  githubGetPR: (t: PrTarget): Promise<PullRequestDetails> => ipcRenderer.invoke('github:get-pr', t),
  githubGetPRDiff: (t: PrTarget): Promise<string> => ipcRenderer.invoke('github:get-pr-diff', t),
  githubGetPRInlineComments: (t: PrTarget): Promise<InlineComment[]> =>
    ipcRenderer.invoke('github:get-pr-inline-comments', t),
  githubGetPRConversation: (t: PrTarget): Promise<ConversationComment[]> =>
    ipcRenderer.invoke('github:get-pr-conversation', t)
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
