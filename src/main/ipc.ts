import { app, clipboard, ipcMain } from 'electron'
import { join } from 'node:path'
import { Octokit } from '@octokit/rest'
import { GitDiffProvider, FileStatus, DiffSourceSpec } from './git-diff-provider'
import { PendingReviewStore, PendingReview, ReviewTarget } from './pending-review-store'
import { toAgentPrompt, toGitHubReview } from './review-formatter'
import { GhAuthResolver, AuthStatus } from './gh-auth-resolver'
import { GitHubClient, InboxResult, OctokitLike, PullRequestDetails, InlineComment, ConversationComment } from './github-client'

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
  reviewSubmitToGithub: 'review:submit-to-github'
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

const provider = new GitDiffProvider()
const ghAuth = new GhAuthResolver()
let storeInstance: PendingReviewStore | null = null
let githubClient: GitHubClient | null = null

async function getGithubClient(): Promise<GitHubClient | null> {
  if (githubClient) return githubClient
  const token = await ghAuth.token()
  if (!token) return null
  githubClient = new GitHubClient(new Octokit({ auth: token }) as unknown as OctokitLike)
  return githubClient
}

function store(): PendingReviewStore {
  if (!storeInstance) {
    storeInstance = new PendingReviewStore(join(app.getPath('userData'), 'pending-reviews.json'))
  }
  return storeInstance
}

export function splitPatchByFile(rawPatch: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!rawPatch.trim()) return map
  const lines = rawPatch.split('\n')
  let start = -1
  for (let i = 0; i <= lines.length; i++) {
    const isBoundary = i === lines.length || lines[i].startsWith('diff --git ')
    if (!isBoundary) continue
    if (start >= 0) {
      const slice = lines.slice(start, i).join('\n')
      const match = lines[start].match(/^diff --git a\/(.+?) b\/(.+)$/)
      const path = match ? match[2] : `__file_${map.size}`
      map.set(path, slice)
    }
    start = i
  }
  return map
}

export function registerIpcHandlers(): void {
  ipcMain.handle(
    CHANNELS.getLocalDiff,
    async (_e, args: { repoPath: string; source?: DiffSourceSpec }): Promise<LocalDiffResult> => {
      const source = args.source ?? { type: 'working-tree-vs-head' as const }
      const [data, rawPatch] = await Promise.all([
        provider.getDiff(args.repoPath, source),
        provider.getRawPatch(args.repoPath, source)
      ])
      const patches = splitPatchByFile(rawPatch)
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
    store().get(target)
  )
  ipcMain.handle(CHANNELS.reviewUpsert, (_e, review: PendingReview): void => store().upsert(review))
  ipcMain.handle(CHANNELS.reviewDelete, (_e, target: ReviewTarget): void => store().delete(target))
  ipcMain.handle(CHANNELS.reviewSubmitToAgent, (_e, review: PendingReview): void => {
    clipboard.writeText(toAgentPrompt(review))
    store().delete(review.target)
  })

  ipcMain.handle(CHANNELS.reviewSubmitToGithub, async (_e, review: PendingReview): Promise<{ url: string }> => {
    if (review.target.kind !== 'pr') throw new Error('submitToGithub requires a pr target')
    const client = await getGithubClient()
    if (!client) throw new Error('gh CLI is not authenticated')
    const payload = toGitHubReview(review)
    const result = await client.submitReview(
      review.target.owner,
      review.target.repo,
      review.target.number,
      payload
    )
    store().delete(review.target)
    return { url: result.html_url }
  })

  ipcMain.handle(CHANNELS.ghAuthStatus, async (): Promise<AuthStatus> => ghAuth.status())

  ipcMain.handle(CHANNELS.githubListPRs, async (): Promise<InboxResult> => {
    const client = await getGithubClient()
    if (!client) throw new Error('gh CLI is not authenticated')
    return client.listInvolvingPRs()
  })

  ipcMain.handle(
    CHANNELS.githubGetPR,
    async (_e, args: { owner: string; repo: string; number: number }): Promise<PullRequestDetails> => {
      const client = await getGithubClient()
      if (!client) throw new Error('gh CLI is not authenticated')
      return client.getPR(args.owner, args.repo, args.number)
    }
  )

  ipcMain.handle(
    CHANNELS.githubGetPRDiff,
    async (_e, args: { owner: string; repo: string; number: number }): Promise<string> => {
      const client = await getGithubClient()
      if (!client) throw new Error('gh CLI is not authenticated')
      return client.getPRDiff(args.owner, args.repo, args.number)
    }
  )

  ipcMain.handle(
    CHANNELS.githubGetPRInlineComments,
    async (_e, args: { owner: string; repo: string; number: number }): Promise<InlineComment[]> => {
      const client = await getGithubClient()
      if (!client) throw new Error('gh CLI is not authenticated')
      return client.getPRInlineComments(args.owner, args.repo, args.number)
    }
  )

  ipcMain.handle(
    CHANNELS.githubGetPRConversation,
    async (_e, args: { owner: string; repo: string; number: number }): Promise<ConversationComment[]> => {
      const client = await getGithubClient()
      if (!client) throw new Error('gh CLI is not authenticated')
      return client.getPRConversation(args.owner, args.repo, args.number)
    }
  )
}
