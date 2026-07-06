import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { CoverageMap } from '../shared/guide-schema'
import type { RenderableSection } from '../shared/guide-view'

const PR_FLAG = '--pr='

/**
 * The PR this window was launched for, parsed from the `--pr=` flag the
 * main process builds from the `homer <pr-url>` argument. Null when launched
 * without a PR URL — the renderer then shows a "paste a PR URL" state.
 */
const prFlag = process.argv.find(a => a.startsWith(PR_FLAG))
const prTarget = prFlag
  ? (() => {
      const [owner, repo, num] = prFlag.slice(PR_FLAG.length).split('/')
      if (!owner || !repo || !num || Number.isNaN(Number(num))) return null
      return { owner, repo, number: Number(num) }
    })()
  : null

/** In-window navigation events pushed by the main process (a second
 *  `homer <pr-url>` invocation focuses this window and points it at that PR). */
export type NavRoute = { kind: 'pr'; target: { owner: string; repo: string; number: number } }

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface FileWithPatch {
  path: string
  oldPath?: string
  status: FileStatus
  isBinary: boolean
  patch: string
}

/** The Destination is always the GitHub PR, so a Review is keyed to (repo, PR). */
export type ReviewTarget = { owner: string; repo: string; number: number }

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
  /**
   * Line Comments that no longer anchored cleanly after a Refresh re-snapshot
   * (ADR 0001). Kept — never silently dropped — so the human-authored text is
   * preserved and surfaced with a warning until the reviewer resolves each one.
   */
  orphanedComments?: LineComment[]
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
  /** The head commit SHA — the revision the session's Guide/Snapshot are built at. */
  headSha: string
  /** The base commit SHA the PR merges into. */
  baseSha: string
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

/** Streamed Guide events carry the generation id so stale runs can be dropped. */
export interface GuideSectionEvent {
  generationId: string
  section: RenderableSection
}
export interface GuideFinalizedEvent {
  generationId: string
  coverage: CoverageMap
}
export interface GuideErrorEvent {
  generationId: string
  message: string
  /**
   * Set when the failure was that no local clone of the PR's repo could be
   * resolved — fixable in Settings → Repository roots. The renderer uses it to
   * offer an "Open Settings" nudge alongside Retry.
   */
  settingsHint?: boolean
}

/**
 * The editable Guide-generation guidance for Settings: the user's saved
 * `custom` guidance (null when unset) and the shipped `default` shown as a
 * known baseline. The fixed emit/finalize contract is never part of this — it is
 * always enforced in the main process — so editing this can't break generation.
 */
export interface GuideSettings {
  custom: string | null
  default: string
}

const api = {
  prTarget,
  onNavigate: (cb: (route: NavRoute) => void): (() => void) => {
    const listener = (_e: unknown, route: NavRoute): void => cb(route)
    ipcRenderer.on('app:navigate', listener)
    return () => ipcRenderer.removeListener('app:navigate', listener)
  },
  reviewGet: (target: ReviewTarget): Promise<PendingReview | null> =>
    ipcRenderer.invoke('review:get', target),
  reviewUpsert: (review: PendingReview): Promise<void> => ipcRenderer.invoke('review:upsert', review),
  reviewDelete: (target: ReviewTarget): Promise<void> => ipcRenderer.invoke('review:delete', target),
  reviewSubmitToGithub: (review: PendingReview): Promise<{ url: string }> =>
    ipcRenderer.invoke('review:submit-to-github', review),
  ghAuthStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('gh:auth-status'),
  githubGetPR: (t: PrTarget): Promise<PullRequestDetails> => ipcRenderer.invoke('github:get-pr', t),
  githubGetPRDiff: (t: PrTarget): Promise<string> => ipcRenderer.invoke('github:get-pr-diff', t),
  githubGetPRInlineComments: (t: PrTarget): Promise<InlineComment[]> =>
    ipcRenderer.invoke('github:get-pr-inline-comments', t),
  githubGetPRConversation: (t: PrTarget): Promise<ConversationComment[]> =>
    ipcRenderer.invoke('github:get-pr-conversation', t),
  /**
   * How many commits the PR's `head` is ahead of `base` — used to report the
   * new-commit count in the staleness banner (base = the session's head SHA,
   * head = the PR's current head SHA).
   */
  githubCommitsAhead: (t: PrTarget, base: string, head: string): Promise<number> =>
    ipcRenderer.invoke('github:commits-ahead', { ...t, base, head }),
  /** Manual "clear cached checkouts": remove all cached PR Worktrees. */
  worktreeClearCache: (): Promise<void> => ipcRenderer.invoke('worktree:clear'),

  /**
   * Read the Guide-generation guidance for Settings: the saved custom guidance
   * (null when unset) plus the shipped default baseline.
   */
  getGuideSettings: (): Promise<GuideSettings> => ipcRenderer.invoke('settings:get-guide'),
  /**
   * Save custom Guide guidance (empty/whitespace clears back to the default).
   * The next Guide generation uses it; the fixed contract + cap always stay.
   */
  setGuideGuidance: (guidance: string | null): Promise<void> =>
    ipcRenderer.invoke('settings:set-guide-guidance', guidance),
  /** Reset the Guide guidance to the shipped default. */
  resetGuideGuidance: (): Promise<void> => ipcRenderer.invoke('settings:reset-guide-guidance'),

  /**
   * The configured repo root directories discovery scans to find a PR's local
   * clone when the launch context (`--repo=` / `DV_REPO` / cwd) doesn't already
   * point at one — so `homer <pr-url>` works from anywhere.
   */
  getRepoRoots: (): Promise<string[]> => ipcRenderer.invoke('settings:get-repo-roots'),
  /** Add a repo root directory; resolves to the updated list. */
  addRepoRoot: (path: string): Promise<string[]> =>
    ipcRenderer.invoke('settings:add-repo-root', path),
  /** Remove a repo root directory; resolves to the updated list. */
  removeRepoRoot: (path: string): Promise<string[]> =>
    ipcRenderer.invoke('settings:remove-repo-root', path),
  /** Open a native directory picker; resolves to the chosen path, or null if cancelled. */
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:choose-directory'),

  /**
   * Start generating the Guide for a PR under a caller-supplied `generationId`.
   * Sections then arrive via `onGuideSection`, completion via `onGuideFinalized`,
   * and any failure via `onGuideError` — each event echoes the `generationId` so
   * the caller can ignore events from a superseded run. Additive: it never
   * rejects — a generation failure surfaces as a `guide:error` event, leaving
   * Activity and Diff untouched. Starting a new generation for the window aborts
   * the previous one.
   */
  startGuide: (t: PrTarget, generationId: string): Promise<void> =>
    ipcRenderer.invoke('guide:generate', { target: t, generationId }),
  onGuideSection: (cb: (event: GuideSectionEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: GuideSectionEvent): void => cb(event)
    ipcRenderer.on('guide:section-emitted', listener)
    return () => ipcRenderer.removeListener('guide:section-emitted', listener)
  },
  onGuideFinalized: (cb: (event: GuideFinalizedEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: GuideFinalizedEvent): void => cb(event)
    ipcRenderer.on('guide:finalized', listener)
    return () => ipcRenderer.removeListener('guide:finalized', listener)
  },
  onGuideError: (cb: (event: GuideErrorEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: GuideErrorEvent): void => cb(event)
    ipcRenderer.on('guide:error', listener)
    return () => ipcRenderer.removeListener('guide:error', listener)
  }
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
