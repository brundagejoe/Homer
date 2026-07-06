import { app } from 'electron'
import { join } from 'node:path'
import { Octokit } from '@octokit/rest'
import { GitDiffProvider } from './git-diff-provider'
import { PendingReviewStore } from './pending-review-store'
import { GhAuthResolver } from './gh-auth-resolver'
import { GitHubClient, OctokitLike } from './github-client'
import { PrWorktreeManager } from './pr-worktree-manager'
import { GuideSource, StubGuideSource } from './guide-source'

/**
 * Composition root for the main process: owns the app's long-lived services as
 * lazy singletons behind small accessor functions. IPC handlers and the app
 * entry both pull their collaborators from here, so wiring lives in one place
 * rather than accreting inside `ipc.ts`.
 */

let providerInstance: GitDiffProvider | null = null
export function diffProvider(): GitDiffProvider {
  if (!providerInstance) providerInstance = new GitDiffProvider()
  return providerInstance
}

let ghAuthInstance: GhAuthResolver | null = null
export function ghAuth(): GhAuthResolver {
  if (!ghAuthInstance) ghAuthInstance = new GhAuthResolver()
  return ghAuthInstance
}

let storeInstance: PendingReviewStore | null = null
export function pendingReviewStore(): PendingReviewStore {
  if (!storeInstance) {
    storeInstance = new PendingReviewStore(join(app.getPath('userData'), 'pending-reviews.json'))
  }
  return storeInstance
}

let githubClientInstance: GitHubClient | null = null
export async function githubClient(): Promise<GitHubClient | null> {
  if (githubClientInstance) return githubClientInstance
  const token = await ghAuth().token()
  if (!token) return null
  githubClientInstance = new GitHubClient(new Octokit({ auth: token }) as unknown as OctokitLike)
  return githubClientInstance
}

let worktreeManagerInstance: PrWorktreeManager | null = null
/**
 * Shared PR Worktree manager. The cache dir lives under Electron's `userData`,
 * outside any user repo. Shared so the app entry can run the startup sweep and
 * session-close cleanup against the same instance the IPC clear action uses.
 */
export function worktreeManager(): PrWorktreeManager {
  if (!worktreeManagerInstance) {
    worktreeManagerInstance = new PrWorktreeManager({
      cacheDir: join(app.getPath('userData'), 'pr-worktrees')
    })
  }
  return worktreeManagerInstance
}

let guideSourceInstance: GuideSource | null = null
/**
 * The Guide generation seam. V1 is a stub Agent that drives the whole pipe with
 * canned Sections; the real `claude` subprocess (`AgentRunner`) replaces it here
 * behind the same `GuideSource` interface without any caller changing.
 */
export function guideSource(): GuideSource {
  if (!guideSourceInstance) guideSourceInstance = new StubGuideSource()
  return guideSourceInstance
}
