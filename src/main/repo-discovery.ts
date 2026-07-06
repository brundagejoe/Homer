import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { parseOwnerRepo, type OwnerRepo } from '../shared/git-remote'

const exec = promisify(execFile)

/** How many directory levels below each configured root we scan for clones. */
const DEFAULT_DEPTH = 2

/** Directory names never worth descending into when hunting for a clone. */
const SKIP_DIRS = new Set(['node_modules'])

/** Cap on concurrent `git` probes per scan level so a big `~/code` can't fork-bomb. */
const SCAN_CONCURRENCY = 16

export interface DiscoverRepoOptions {
  owner: string
  repo: string
  /** The configured repo root directories to scan (Settings → Repository roots). */
  roots: string[]
  /** Directory levels below each root to scan (default 2: root children and grandchildren). */
  depth?: number
}

/**
 * Find the local clone whose git remotes point at `owner/repo` by scanning the
 * configured root directories to a bounded depth. Returns the match's absolute
 * path, or `null` when none is found.
 *
 * Matches against EVERY remote (origin, upstream, …), not just `origin`, so a
 * fork workflow — where the canonical repo the PR targets is `upstream` and
 * `origin` is the user's fork — is found.
 *
 * Resilient by construction: a root that doesn't exist, a directory that isn't a
 * repo, or a git error is skipped rather than thrown, so one bad entry never
 * aborts discovery. `node_modules` and dotdirs are never descended into, and a
 * directory found to be a git repo is not walked deeper.
 *
 * Fast: each level's directories are probed in parallel (bounded), and the scan
 * returns as soon as a clone whose folder name equals the repo is found. When
 * several clones match (e.g. a repo and a fork of it), that exact-folder-name
 * match is preferred; otherwise the first discovered wins.
 */
export async function discoverRepo(options: DiscoverRepoOptions): Promise<string | null> {
  const target: OwnerRepo = { owner: options.owner, repo: options.repo }
  const depth = options.depth ?? DEFAULT_DEPTH
  const wantName = options.repo.toLowerCase()

  const matches: string[] = []
  let level = dedupe(options.roots)

  for (let d = 0; d <= depth && level.length > 0; d++) {
    const infos = await mapWithConcurrency(level, SCAN_CONCURRENCY, async dir => ({
      dir,
      ...(await inspect(dir, target))
    }))

    for (const info of infos) {
      if (!info.matched) continue
      matches.push(info.dir)
      // Short-circuit the moment we find an exact folder-name match — no point
      // probing the rest of the tree once the best possible candidate is in hand.
      if (basename(info.dir).toLowerCase() === wantName) return info.dir
    }

    if (d === depth) break
    // Descend only into non-repo directories: a git repo's subtree can't hold a
    // better match for this target, and we've already recorded it if it matched.
    const nextParents = infos.filter(i => !i.isRepo).map(i => i.dir)
    level = (await Promise.all(nextParents.map(childDirs))).flat()
  }

  if (matches.length === 0) return null
  return matches[0]
}

/** Inspect one directory: is it a git repo, and does any remote match the target? */
async function inspect(
  dir: string,
  target: OwnerRepo
): Promise<{ isRepo: boolean; matched: boolean }> {
  const remotes = await readRemotes(dir)
  if (remotes === null) return { isRepo: false, matched: false }
  return { isRepo: true, matched: remotes.some(url => remoteMatches(url, target)) }
}

/**
 * Whether the git clone at `dir` has ANY remote (origin, upstream, …) pointing
 * at `owner/repo` (case-insensitive). False for a non-repo, a repo with no
 * matching remote, or only non-GitHub / unparseable remotes — never throws.
 */
export async function repoMatchesTarget(dir: string, target: OwnerRepo): Promise<boolean> {
  const remotes = await readRemotes(dir)
  if (remotes === null) return false
  return remotes.some(url => remoteMatches(url, target))
}

/** Whether `dir` is a git working tree at all (used for the last-resort fallback). */
export async function isGitRepo(dir: string): Promise<boolean> {
  return (await readRemotes(dir)) !== null
}

export interface ResolveRepoOptions {
  target: OwnerRepo
  /** The launch-context repo (`--repo=` / `DV_REPO` / cwd), or null if none. */
  launchContext: string | null
  /** Configured repo roots to auto-discover under. */
  roots: string[]
  depth?: number
}

/**
 * Resolve the source repo for a PR. A *verified* match (a git repo with a remote
 * pointing at the target) always wins; the launch context is only used unverified
 * as a last resort. Order:
 *   1. launch context whose ANY remote matches the target → use it;
 *   2. a discovered clone under the roots whose ANY remote matches → use it;
 *   3. launch context if it's a git repo at all (unverified) — the
 *      pre-discovery behavior, so a reviewer standing in the right checkout with
 *      an unclassifiable remote (private/GHE host, unrecognized SSH alias, an
 *      unparseable fork remote) still works;
 *   4. otherwise throw `RepoNotFoundError`.
 * Steps 1–2 ensure an *unrelated* launch context is never used when the real
 * clone exists.
 */
export async function resolveRepoForTarget(options: ResolveRepoOptions): Promise<string> {
  const { target, launchContext, roots, depth } = options

  if (launchContext && (await repoMatchesTarget(launchContext, target))) {
    return launchContext
  }

  const discovered = await discoverRepo({ ...target, roots, depth })
  if (discovered) return discovered

  if (launchContext && (await isGitRepo(launchContext))) {
    return launchContext
  }

  throw new RepoNotFoundError(target, roots.length > 0)
}

function remoteMatches(url: string, target: OwnerRepo): boolean {
  const parsed = parseOwnerRepo(url)
  if (!parsed) return false
  return (
    parsed.owner.toLowerCase() === target.owner.toLowerCase() &&
    parsed.repo.toLowerCase() === target.repo.toLowerCase()
  )
}

/**
 * Thrown when the source repo for a generation can't be resolved: the launch
 * context (`--repo=` / `DV_REPO` / cwd) isn't a git repo and no configured root
 * contains a clone of the PR's repo. Carries whether any roots are configured so
 * the UI can nudge a first-time user to add one.
 */
export class RepoNotFoundError extends Error {
  constructor(
    readonly target: OwnerRepo,
    readonly hasRoots: boolean
  ) {
    const where = hasRoots
      ? 'None of your configured repository roots contain it'
      : 'No repository roots are configured'
    super(
      `Couldn't find a local clone of ${target.owner}/${target.repo}. ${where} — ` +
        'add its parent folder in Settings → Repository roots, or launch Homer from inside the repo.'
    )
    this.name = 'RepoNotFoundError'
  }
}

/**
 * All of a repo's remote URLs (deduped), or `null` when `dir` isn't a git repo.
 * A repo with no remotes configured returns `[]` (still a repo). Never throws.
 */
async function readRemotes(dir: string): Promise<string[] | null> {
  let stdout: string
  try {
    ;({ stdout } = await exec('git', ['-C', dir, 'remote', '-v']))
  } catch {
    return null // not a git repository (or git unavailable)
  }
  const urls = new Set<string>()
  for (const line of stdout.split('\n')) {
    // Format: "<name>\t<url> (fetch|push)"
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 2 && parts[1]) urls.add(parts[1])
  }
  return [...urls]
}

/** Subdirectories of `dir` worth descending into (skips dotdirs, node_modules, files). */
async function childDirs(dir: string): Promise<string[]> {
  let entries: { name: string; isDirectory: () => boolean }[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return [] // not a readable directory (e.g. a root that doesn't exist) — skip
  }
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .map(e => join(dir, e.name))
}

function dedupe(paths: string[]): string[] {
  return [...new Set(paths)]
}

/** Map `items` through `fn` with at most `limit` promises in flight, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker)
  await Promise.all(workers)
  return results
}
