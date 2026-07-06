import { ipcMain } from 'electron'
import { FileStatus } from './git-diff-provider'
import { PendingReview, ReviewTarget } from './pending-review-store'
import { toGitHubReview } from './review-formatter'
import { AuthStatus } from './gh-auth-resolver'
import { PullRequestDetails, InlineComment, ConversationComment } from './github-client'
import {
  ghAuth,
  githubClient,
  guideSource,
  pendingReviewStore,
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
  reviewSubmitToGithub: 'review:submit-to-github',
  worktreeClear: 'worktree:clear',
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

  ipcMain.handle(
    CHANNELS.guideGenerate,
    async (e, target: { owner: string; repo: string; number: number }): Promise<void> => {
      // Stream Sections to the window that asked, as the Agent emits them. The
      // Guide is additive: a generation failure surfaces as a `guide:error`
      // event and never rejects the invoke or disturbs Activity/Diff.
      const sender = e.sender
      try {
        for await (const event of guideSource().generate(target)) {
          if (sender.isDestroyed()) return
          if (event.type === 'section') sender.send(CHANNELS.guideSectionEmitted, event.section)
          else sender.send(CHANNELS.guideFinalized, event.coverage)
        }
      } catch (err) {
        if (!sender.isDestroyed()) {
          sender.send(CHANNELS.guideError, { message: (err as Error).message ?? String(err) })
        }
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
}
