import { app } from 'electron'
import { join } from 'node:path'
import { Octokit } from '@octokit/rest'
import { GitDiffProvider } from './git-diff-provider'
import { PendingReviewStore } from './pending-review-store'
import { GhAuthResolver } from './gh-auth-resolver'
import { GitHubClient, OctokitLike } from './github-client'
import { PrWorktreeManager } from './pr-worktree-manager'
import { GuideSource, StubGuideSource } from './guide-source'
import { AgentRunner } from './agent-runner'
import { CachingGuideSource } from './caching-guide-source'
import { GuideStore } from './guide-store'
import { SettingsStore } from './settings-store'
import { resolveAgentConfig, type McpBridgeSpec } from './agent-config'
import { resolveRepoPath } from './launch'
import { resolveRepoForTarget } from './repo-discovery'
import type { GuideRequest } from './guide-source'

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

/**
 * How `claude` should spawn the tool bridge (an MCP stdio server). We reuse the
 * Electron binary as a Node runtime (`ELECTRON_RUN_AS_NODE=1`) to run the bundled
 * bridge script, so there's no dependency on a separate `node` on PATH; the
 * `DV_TOOL_BRIDGE` flag is what makes that script start the server.
 */
function toolBridgeSpec(): McpBridgeSpec {
  return {
    command: process.execPath,
    args: [join(__dirname, 'agent-tool-bridge.js')],
    env: { ELECTRON_RUN_AS_NODE: '1', DV_TOOL_BRIDGE: '1' }
  }
}

let guideStoreInstance: GuideStore | null = null
/**
 * The disposable Guide cache. Lives under Electron's `userData` (outside any
 * user repo). Losing it only costs a regeneration, so it is a cache, not durable
 * state — contrast `pendingReviewStore`, which is the one non-regenerable store.
 */
export function guideStore(): GuideStore {
  if (!guideStoreInstance) {
    guideStoreInstance = new GuideStore({ cacheDir: join(app.getPath('userData'), 'guide-cache') })
  }
  return guideStoreInstance
}

let settingsStoreInstance: SettingsStore | null = null
/**
 * Durable app settings (JSON under `userData`). Currently holds the user's
 * custom Guide-generation guidance; `null` there means "use the shipped
 * default". Shared so the IPC handlers and the Agent read the same instance.
 */
export function settingsStore(): SettingsStore {
  if (!settingsStoreInstance) {
    settingsStoreInstance = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  }
  return settingsStoreInstance
}

/**
 * Resolve the source repo the PR Worktree is materialized from, for one PR — the
 * composition wrapper that gathers the launch context (`--repo=` → `DV_REPO` →
 * cwd) and the configured repo roots, then applies the resolution policy in
 * `resolveRepoForTarget` (verified match wins; launch context is a last resort;
 * else `RepoNotFoundError`).
 */
export async function resolveSourceRepo(request: GuideRequest): Promise<string> {
  return resolveRepoForTarget({
    target: { owner: request.owner, repo: request.repo },
    launchContext: resolveRepoPath(process.argv, process.env, process.cwd()),
    roots: settingsStore().getRepoRoots()
  })
}

let guideSourceInstance: GuideSource | null = null
/**
 * The Guide generation seam. Default is the real `claude` Agent (`AgentRunner`)
 * wrapped in `CachingGuideSource`: re-opening a PR at a head SHA already
 * generated for replays the cached Guide instantly with no Agent spawn, while a
 * new/absent SHA generates and then caches. Both are the same `GuideSource`
 * interface, so callers (the `guide:generate` IPC handler) are unaffected.
 *
 * Set `DV_GUIDE_STUB=1` to fall back to the offline `StubGuideSource` for
 * dev/tests without spending a subscription run; the stub is left un-cached (it
 * ignores the head SHA and never needs a GitHub client) so it stays offline.
 */
export function guideSource(): GuideSource {
  if (guideSourceInstance) return guideSourceInstance
  if (process.env.DV_GUIDE_STUB === '1') {
    guideSourceInstance = new StubGuideSource()
  } else {
    const runner = new AgentRunner({
      worktrees: worktreeManager(),
      github: githubClient,
      // The source repo the worktree is materialized from, resolved per
      // generation from the PR's owner/repo: the launch context if it's a clone
      // of this PR's repo, else an auto-discovered clone under the configured
      // repo roots (`resolveSourceRepo`). Lazy — so a cached Guide replays
      // without needing a local clone at all.
      sourceRepoPath: resolveSourceRepo,
      config: resolveAgentConfig(toolBridgeSpec()),
      // Read the effective custom guidance lazily, per run, so a Settings edit
      // takes effect on the next generation without restarting the app. `null`
      // (unset) means the shipped default guidance is used.
      guidance: () => settingsStore().getGuideGuidance()
    })
    // The head SHA — the last axis of the cache key — is resolved once in the
    // `guide:generate` IPC handler and travels in the `GuideRequest`, so the
    // coordinator needs only the inner Agent and the store.
    guideSourceInstance = new CachingGuideSource({ inner: runner, store: guideStore() })
  }
  return guideSourceInstance
}
