import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: repo, maxBuffer: 50 * 1024 * 1024 })
  return stdout
}

/** A persisted record of one materialized PR Worktree. */
interface WorktreeEntry {
  key: string
  repoPath: string
  sha: string
  path: string
  lastUsed: number
}

type Index = Record<string, WorktreeEntry>

export interface PrWorktreeManagerOptions {
  /**
   * App-owned cache dir where worktrees are materialized — must live OUTSIDE
   * any user repo (in production: under Electron's `userData`). Injected so
   * tests can point it at a temp dir.
   */
  cacheDir: string
  /** Max number of cached worktrees kept on disk before LRU eviction kicks in. */
  maxWorktrees?: number
}

const DEFAULT_MAX_WORKTREES = 5

/**
 * Owns the lifecycle of PR Worktrees: dedicated `git worktree`s checked out at
 * a PR head SHA, materialized in an app-owned cache dir outside the user's repo
 * so the Agent gets full-repo context as of the PR without touching the
 * reviewer's working tree.
 *
 * The public surface hides all git-worktree internals: `acquire` / `release`
 * for the session, `sweep` for startup crash-survivor cleanup, an LRU disk cap,
 * and `clear` for the manual "clear cached checkouts" action.
 *
 * All mutating operations are serialized through a single in-process lock and
 * share one in-memory index that is persisted atomically, so a concurrent
 * acquire can never clobber a sweep (and vice versa) and a partial write can
 * never corrupt the on-disk registry.
 */
export class PrWorktreeManager {
  private readonly cacheDir: string
  private readonly treesDir: string
  private readonly indexPath: string
  private readonly maxWorktrees: number

  /** Keys acquired in THIS process — the live sessions sweep/LRU must preserve. */
  private readonly live = new Set<string>()

  /** Strictly-increasing recency clock so rapid acquires never tie on LRU order. */
  private clock = 0

  /** In-memory registry (lazily loaded from disk); source of truth in-process. */
  private index: Index | null = null

  /** Serializes all read-modify-write cycles against the index. */
  private lock: Promise<unknown> = Promise.resolve()

  constructor(options: PrWorktreeManagerOptions) {
    this.cacheDir = options.cacheDir
    this.treesDir = join(this.cacheDir, 'trees')
    this.indexPath = join(this.cacheDir, 'index.json')
    this.maxWorktrees = options.maxWorktrees ?? DEFAULT_MAX_WORKTREES
  }

  /**
   * Materialize (or reuse) a worktree for `repoPath` at `sha` and return its
   * absolute path. Fetches the SHA into the repo's object store if it isn't
   * present locally, then registers a `git worktree` in the cache dir. Marks
   * the worktree live for this session and bumps its LRU recency.
   */
  acquire(repoPath: string, sha: string): Promise<string> {
    return this.withLock(async () => {
      const key = keyFor(repoPath, sha)
      const index = await this.loadIndex()

      const existing = index[key]
      if (existing && (await pathExists(existing.path))) {
        existing.lastUsed = this.nextStamp()
        this.live.add(key)
        await this.persist()
        return existing.path
      }

      await mkdir(this.treesDir, { recursive: true })
      await this.ensureSha(repoPath, sha)

      const path = join(this.treesDir, key)

      // Record the entry (with its repoPath) BEFORE `git worktree add`. If we
      // crash mid-add, the registration always has a matching index entry, so
      // cleanup can find the repo to prune — no leaked registrations.
      index[key] = { key, repoPath, sha, path, lastUsed: this.nextStamp() }
      await this.persist()

      await rm(path, { recursive: true, force: true })
      await git(repoPath, ['worktree', 'add', '--detach', '--force', path, sha])

      index[key].lastUsed = this.nextStamp()
      this.live.add(key)
      await this.evictBeyondCap(index)
      await this.persist()
      return path
    })
  }

  /**
   * Remove the worktree for `repoPath` at `sha`: unregister it with
   * `git worktree remove`, delete its folder, and drop it from the index and
   * the live set. Safe to call for an already-gone worktree.
   */
  release(repoPath: string, sha: string): Promise<void> {
    return this.withLock(async () => {
      const key = keyFor(repoPath, sha)
      const index = await this.loadIndex()
      const entry = index[key]
      this.live.delete(key)
      if (!entry) return
      await this.removeWorktree(entry)
      delete index[key]
      await this.persist()
    })
  }

  /**
   * Release every worktree acquired in this session — the session-close
   * cleanup path. Leaves worktrees from other/older sessions to `sweep`/LRU.
   */
  releaseAll(): Promise<void> {
    return this.withLock(async () => {
      const index = await this.loadIndex()
      for (const key of [...this.live]) {
        const entry = index[key]
        this.live.delete(key)
        if (!entry) continue
        await this.removeWorktree(entry)
        delete index[key]
      }
      await this.persist()
    })
  }

  /**
   * Startup cleanup for crash survivors: remove every registered worktree that
   * isn't live in this session (a fresh process has no live sessions, so all
   * cached worktrees are survivors), delete any stray folder in the cache with
   * no index entry, and `git worktree prune` every source repo touched so no
   * dangling `.git/worktrees/<name>` registration is left behind.
   */
  sweep(): Promise<void> {
    return this.withLock(async () => {
      const index = await this.loadIndex()
      const repos = new Set<string>()

      for (const entry of Object.values(index)) {
        if (this.live.has(entry.key)) continue
        repos.add(entry.repoPath)
        await this.removeWorktree(entry)
        delete index[entry.key]
      }

      // Delete stray folders with no index entry (e.g. a crash between
      // `git worktree add` and the index write), pruning their source repo —
      // discovered from the worktree's own `.git` pointer file.
      const live = new Set(Object.values(index).map(e => e.path))
      for (const name of await this.listTreeFolders()) {
        const full = join(this.treesDir, name)
        if (live.has(full)) continue
        const repo = await repoOfWorktree(full)
        if (repo) repos.add(repo)
        await rm(full, { recursive: true, force: true })
      }

      await this.pruneRepos(repos)
      await this.persist()
    })
  }

  /**
   * Manual "clear cached checkouts": remove every cached worktree (live or not),
   * reset the cache dir, and prune every source repo touched. Backs the manual
   * reclaim-disk action.
   */
  clear(): Promise<void> {
    return this.withLock(async () => {
      const index = await this.loadIndex()
      const repos = new Set<string>()

      for (const entry of Object.values(index)) {
        repos.add(entry.repoPath)
        await this.removeWorktree(entry)
      }
      // Also prune repos of any untracked folders (index may be empty/corrupt).
      for (const name of await this.listTreeFolders()) {
        const repo = await repoOfWorktree(join(this.treesDir, name))
        if (repo) repos.add(repo)
      }

      this.live.clear()
      await rm(this.treesDir, { recursive: true, force: true })
      await this.pruneRepos(repos)
      this.index = {}
      await this.persist()
    })
  }

  /**
   * Enforce the LRU disk cap: while more worktrees are cached than the cap
   * allows, remove the least-recently-used NON-live worktree. Live worktrees
   * (held by the current session) are never evicted, so the cap never pulls a
   * checkout out from under an open Guide/agent.
   */
  private async evictBeyondCap(index: Index): Promise<void> {
    while (Object.keys(index).length > this.maxWorktrees) {
      const victim = Object.values(index)
        .filter(e => !this.live.has(e.key))
        .sort((a, b) => a.lastUsed - b.lastUsed)[0]
      if (!victim) break // everything left is live — cannot evict safely
      await this.removeWorktree(victim)
      delete index[victim.key]
    }
  }

  /**
   * Tear down one worktree registration + folder. Prefers `git worktree
   * remove` (which unregisters cleanly); falls back to deleting the folder and
   * pruning stale registrations if the folder is already gone or git balks.
   */
  private async removeWorktree(entry: WorktreeEntry): Promise<void> {
    try {
      await git(entry.repoPath, ['worktree', 'remove', '--force', entry.path])
    } catch {
      await rm(entry.path, { recursive: true, force: true })
      try {
        await git(entry.repoPath, ['worktree', 'prune'])
      } catch {
        // Repo may be gone entirely — nothing left to prune.
      }
    }
  }

  /** Best-effort `git worktree prune` across every source repo touched. */
  private async pruneRepos(repos: Set<string>): Promise<void> {
    for (const repo of repos) {
      try {
        await git(repo, ['worktree', 'prune'])
      } catch {
        // Repo may be gone entirely — nothing left to prune.
      }
    }
  }

  private async listTreeFolders(): Promise<string[]> {
    try {
      return await readdir(this.treesDir)
    } catch {
      return []
    }
  }

  /** Fetch `sha` from origin only if the object store doesn't already have it. */
  private async ensureSha(repoPath: string, sha: string): Promise<void> {
    try {
      await git(repoPath, ['cat-file', '-e', `${sha}^{commit}`])
      return
    } catch {
      // Not present locally — try to fetch it (best effort; may be offline).
    }
    await git(repoPath, ['fetch', '--no-tags', 'origin', sha])
  }

  /** Wall-clock-ish, but guaranteed to strictly increase within this process. */
  private nextStamp(): number {
    this.clock = Math.max(Date.now(), this.clock + 1)
    return this.clock
  }

  /** Serialize a read-modify-write cycle; the next op waits for this to settle. */
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.lock.then(fn, fn)
    this.lock = result.then(
      () => {},
      () => {}
    )
    return result
  }

  private async loadIndex(): Promise<Index> {
    if (!this.index) this.index = await this.readIndexFromDisk()
    return this.index
  }

  /**
   * Read the registry from disk. A missing file starts empty; a corrupt file is
   * set aside (renamed) rather than silently returned as `{}` — otherwise the
   * next write would drop every tracked registration and leak its folders.
   */
  private async readIndexFromDisk(): Promise<Index> {
    let raw: string
    try {
      raw = await readFile(this.indexPath, 'utf8')
    } catch {
      return {}
    }
    try {
      return JSON.parse(raw) as Index
    } catch {
      try {
        await rename(this.indexPath, `${this.indexPath}.corrupt-${Date.now()}`)
      } catch {
        // Best effort — if we can't preserve it, we still start fresh below.
      }
      return {}
    }
  }

  /** Persist the in-memory index atomically (temp file + rename). */
  private async persist(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true })
    const tmp = `${this.indexPath}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(this.index ?? {}, null, 2))
    await rename(tmp, this.indexPath)
  }
}

/** Deterministic, filesystem-safe key namespaced by (repo, sha). */
function keyFor(repoPath: string, sha: string): string {
  const hash = createHash('sha256').update(`${repoPath}\0${sha}`).digest('hex').slice(0, 10)
  return `${sha.slice(0, 12)}-${hash}`
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await readdir(p)
    return true
  } catch {
    return false
  }
}

/**
 * Recover the source repo of a materialized worktree by reading its `.git`
 * pointer file (`gitdir: <repo>/.git/worktrees/<name>`). Lets cleanup prune a
 * dangling registration even when the index entry has been lost.
 */
async function repoOfWorktree(folder: string): Promise<string | null> {
  try {
    const contents = await readFile(join(folder, '.git'), 'utf8')
    const match = contents.match(/gitdir:\s*(.+)/)
    if (!match) return null
    const gitdir = match[1].trim()
    const marker = '/.git/worktrees/'
    const idx = gitdir.indexOf(marker)
    return idx === -1 ? null : gitdir.slice(0, idx)
  } catch {
    return null
  }
}
