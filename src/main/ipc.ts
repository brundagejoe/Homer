import { clipboard, ipcMain } from 'electron'
import { FileStatus, DiffSourceSpec } from './git-diff-provider'
import { PendingReview, ReviewTarget } from './pending-review-store'
import { toAgentPrompt, toGitHubReview } from './review-formatter'
import { AuthStatus } from './gh-auth-resolver'
import { InboxResult, PullRequestDetails, InlineComment, ConversationComment } from './github-client'
import { splitPatchByFile } from '../shared/split-patch'
import {
  diffProvider,
  ghAuth,
  githubClient,
  guideSource,
  pendingReviewStore,
  worktreeManager
} from './services'

export const CHANNELS = {
  getLocalDiff: 'git:local-diff',
  reviewGet: 'review:get',
  reviewUpsert: 'review:upsert',
  reviewDelete: 'review:delete',
  reviewSubmitToAgent: 'review:submit-to-agent',
  ghAuthStatus: 'gh:auth-status',
  githubListPRs: 'github:list-prs',
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

export interface LocalDiffResult {
  files: FileWithPatch[]
}

export function registerIpcHandlers(): void {
  ipcMain.handle(
    CHANNELS.getLocalDiff,
    async (_e, args: { repoPath: string; source?: DiffSourceSpec }): Promise<LocalDiffResult> => {
      const source = args.source ?? { type: 'working-tree-vs-head' as const }
      const [data, rawPatch] = await Promise.all([
        diffProvider().getDiff(args.repoPath, source),
        diffProvider().getRawPatch(args.repoPath, source)
      ])
      const patches = new Map(splitPatchByFile(rawPatch).map(p => [p.path, p.patch]))
      return {
        files: data.files.map(f => ({
          path: f.path,
          oldPath: f.oldPath,
          status: f.status,
          isBinary: f.isBinary,
          patch: patches.get(f.path) ?? ''
        }))
      }
    }
  )

  ipcMain.handle(CHANNELS.reviewGet, (_e, target: ReviewTarget): PendingReview | null =>
    pendingReviewStore().get(target)
  )
  ipcMain.handle(CHANNELS.reviewUpsert, (_e, review: PendingReview): void =>
    pendingReviewStore().upsert(review)
  )
  ipcMain.handle(CHANNELS.reviewDelete, (_e, target: ReviewTarget): void =>
    pendingReviewStore().delete(target)
  )
  ipcMain.handle(CHANNELS.reviewSubmitToAgent, (_e, review: PendingReview): void => {
    clipboard.writeText(toAgentPrompt(review))
    pendingReviewStore().delete(review.target)
  })

  ipcMain.handle(CHANNELS.reviewSubmitToGithub, async (_e, review: PendingReview): Promise<{ url: string }> => {
    if (review.target.kind !== 'pr') throw new Error('submitToGithub requires a pr target')
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

  ipcMain.handle(CHANNELS.githubListPRs, async (): Promise<InboxResult> => {
    const client = await githubClient()
    if (!client) throw new Error('gh CLI is not authenticated')
    return client.listInvolvingPRs()
  })

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
