import { ipcMain } from 'electron'
import { FileStatus } from './git-diff-provider'
import { PendingReview, ReviewTarget } from './pending-review-store'
import { toGitHubReview } from './review-formatter'
import { AuthStatus } from './gh-auth-resolver'
import { PullRequestDetails, InlineComment, ConversationComment } from './github-client'
import { WindowGenerations } from './generation-registry'
import { DEFAULT_GUIDE_GUIDANCE } from './agent-prompt'
import {
  ghAuth,
  githubClient,
  guideSource,
  pendingReviewStore,
  settingsStore,
  worktreeManager
} from './services'

export const CHANNELS = {
  reviewGet: 'review:get',
  reviewUpsert: 'review:upsert',
  reviewDelete: 'review:delete',
  ghAuthStatus: 'gh:auth-status',
  githubGetPR: 'github:get-pr',
  githubGetPRDiff: 'github:get-pr-diff',
  githubGetPRInlineComments: 'github:get-pr-inline-comments',
  githubGetPRConversation: 'github:get-pr-conversation',
  githubCommitsAhead: 'github:commits-ahead',
  reviewSubmitToGithub: 'review:submit-to-github',
  worktreeClear: 'worktree:clear',
  settingsGetGuide: 'settings:get-guide',
  settingsSetGuideGuidance: 'settings:set-guide-guidance',
  settingsResetGuideGuidance: 'settings:reset-guide-guidance',
  guideGenerate: 'guide:generate',
  // Main → renderer streaming events (pushed via webContents.send).
  guideSectionEmitted: 'guide:section-emitted',
  guideFinalized: 'guide:finalized',
  guideError: 'guide:error'
} as const

export interface FileWithPatch {
  path: string
  oldPath?: string
  status: FileStatus
  isBinary: boolean
  patch: string
}

/**
 * The Guide-guidance settings the renderer needs: the user's saved `custom`
 * guidance (null when unset) plus the shipped `default`, so Settings can prefill
 * the current guidance and show the default as a known baseline to edit / reset
 * to.
 */
export interface GuideSettings {
  custom: string | null
  default: string
}

/**
 * One in-flight Guide generation per window. Starting a new generation aborts
 * the window's previous one (and closing the window aborts it), so navigating
 * A→B never leaks the prior run or cross-contaminates the new Guide.
 */
const generations = new WindowGenerations()

export function registerIpcHandlers(): void {
  ipcMain.handle(CHANNELS.reviewGet, (_e, target: ReviewTarget): PendingReview | null =>
    pendingReviewStore().get(target)
  )
  ipcMain.handle(CHANNELS.reviewUpsert, (_e, review: PendingReview): void =>
    pendingReviewStore().upsert(review)
  )
  ipcMain.handle(CHANNELS.reviewDelete, (_e, target: ReviewTarget): void =>
    pendingReviewStore().delete(target)
  )

  ipcMain.handle(CHANNELS.reviewSubmitToGithub, async (_e, review: PendingReview): Promise<{ url: string }> => {
    const client = await githubClient()
    if (!client) throw new Error('gh CLI is not authenticated')
    const payload = toGitHubReview(review)
    const result = await client.submitReview(
      review.target.owner,
      review.target.repo,
      review.target.number,
      payload
    )
    pendingReviewStore().delete(review.target)
    return { url: result.html_url }
  })

  ipcMain.handle(CHANNELS.worktreeClear, async (): Promise<void> => worktreeManager().clear())

  // Settings: the editable Guide-generation guidance. The fixed emit/finalize
  // contract lives in `agent-prompt` and is never exposed here, so nothing the
  // renderer sends can strip it — a bad edit only changes tone, never the
  // machine contract or the section cap.
  ipcMain.handle(
    CHANNELS.settingsGetGuide,
    (): GuideSettings => ({
      custom: settingsStore().getGuideGuidance(),
      default: DEFAULT_GUIDE_GUIDANCE
    })
  )
  ipcMain.handle(CHANNELS.settingsSetGuideGuidance, (_e, guidance: string | null): void =>
    settingsStore().setGuideGuidance(guidance)
  )
  ipcMain.handle(CHANNELS.settingsResetGuideGuidance, (): void =>
    settingsStore().resetGuideGuidance()
  )

  ipcMain.handle(
    CHANNELS.guideGenerate,
    async (
      e,
      args: { target: { owner: string; repo: string; number: number }; generationId: string }
    ): Promise<void> => {
      // Stream Sections to the window that asked, as the Agent emits them. The
      // Guide is additive: a generation failure surfaces as a `guide:error`
      // event and never rejects the invoke or disturbs Activity/Diff.
      const sender = e.sender
      const { target, generationId } = args

      // The window-scoped owner aborts the window's previous run and wires
      // teardown; the handler keeps no lifecycle state of its own.
      const controller = generations.start(sender)
      const signal = controller.signal

      try {
        // Resolve the PR head SHA exactly ONCE here — it's part of the Guide's
        // identity, so keying the cache and generating the worktree must agree on
        // it. It then travels in the GuideRequest; the Agent no longer re-derives
        // it. When `gh` isn't authed we can't resolve it, so we pass through and
        // let the source surface the auth error (the offline stub ignores it).
        const client = await githubClient()
        const headSha = client
          ? (await client.getPR(target.owner, target.repo, target.number)).headSha
          : ''
        if (signal.aborted || sender.isDestroyed()) return

        for await (const event of guideSource().generate({ ...target, headSha }, signal)) {
          if (signal.aborted || sender.isDestroyed()) return
          // Every event carries the generation id so the renderer can drop any
          // late event from a superseded run (belt-and-suspenders with abort).
          if (event.type === 'section') {
            sender.send(CHANNELS.guideSectionEmitted, { generationId, section: event.section })
          } else {
            sender.send(CHANNELS.guideFinalized, { generationId, coverage: event.coverage })
          }
        }
      } catch (err) {
        if (!signal.aborted && !sender.isDestroyed()) {
          sender.send(CHANNELS.guideError, {
            generationId,
            message: (err as Error).message ?? String(err)
          })
        }
      } finally {
        generations.finish(sender, controller)
      }
    }
  )

  ipcMain.handle(CHANNELS.ghAuthStatus, async (): Promise<AuthStatus> => ghAuth().status())

  ipcMain.handle(
    CHANNELS.githubGetPR,
    async (_e, args: { owner: string; repo: string; number: number }): Promise<PullRequestDetails> => {
      const client = await githubClient()
      if (!client) throw new Error('gh CLI is not authenticated')
      return client.getPR(args.owner, args.repo, args.number)
    }
  )

  ipcMain.handle(
    CHANNELS.githubGetPRDiff,
    async (_e, args: { owner: string; repo: string; number: number }): Promise<string> => {
      const client = await githubClient()
      if (!client) throw new Error('gh CLI is not authenticated')
      return client.getPRDiff(args.owner, args.repo, args.number)
    }
  )

  ipcMain.handle(
    CHANNELS.githubGetPRInlineComments,
    async (_e, args: { owner: string; repo: string; number: number }): Promise<InlineComment[]> => {
      const client = await githubClient()
      if (!client) throw new Error('gh CLI is not authenticated')
      return client.getPRInlineComments(args.owner, args.repo, args.number)
    }
  )

  ipcMain.handle(
    CHANNELS.githubGetPRConversation,
    async (_e, args: { owner: string; repo: string; number: number }): Promise<ConversationComment[]> => {
      const client = await githubClient()
      if (!client) throw new Error('gh CLI is not authenticated')
      return client.getPRConversation(args.owner, args.repo, args.number)
    }
  )

  ipcMain.handle(
    CHANNELS.githubCommitsAhead,
    async (
      _e,
      args: { owner: string; repo: string; base: string; head: string }
    ): Promise<number> => {
      const client = await githubClient()
      if (!client) throw new Error('gh CLI is not authenticated')
      return client.commitsAhead(args.owner, args.repo, args.base, args.head)
    }
  )
}
