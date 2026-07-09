import { parsePrUrl } from './pr-url'

export interface PrTarget {
  owner: string
  repo: string
  number: number
}

const PR_FLAG = '--pr='
const REPO_FLAG = '--repo='

/**
 * Resolve a launch from CLI argv: the single entry point is a GitHub PR
 * URL (`homer <pr-url>`). Returns the first argument that parses as a PR
 * URL, or null when none is present (the window then shows a
 * "paste a PR URL" state rather than the dead inbox/local-mode routes).
 */
export function resolveLaunchTarget(argv: string[]): PrTarget | null {
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('-') || arg.includes('app.asar')) continue
    const parsed = parsePrUrl(arg)
    if (parsed) return parsed
  }
  return null
}

/**
 * Encode a launch as the window's renderer args: a `--pr=` flag for the target
 * (omitted when there's none — the window shows the "paste a PR URL" state) and,
 * when known, the `--repo=` launch context. Each window carries its own repo
 * context so per-window Guide generation resolves the PR against the repo *that
 * window* was launched from, not the main process's argv (multi-window).
 */
export function buildLaunchArgs(target: PrTarget | null, repoPath?: string): string[] {
  const args = target ? [`${PR_FLAG}${target.owner}/${target.repo}/${target.number}`] : []
  if (repoPath) args.push(`${REPO_FLAG}${repoPath}`)
  return args
}

/**
 * Resolve which repo the app treats as the source repo for the PR Worktree /
 * git / gh context. Precedence:
 *   1. an explicit `--repo=<abs path>` launch flag — set by the global `homer`
 *      shim, which captures the user's `$PWD` because a globally-installed
 *      `.app` launches with cwd `/`, not the repo the reviewer ran `homer` in;
 *   2. the `DV_REPO` env var (a scripting/testing escape hatch);
 *   3. the launch cwd — the in-repo dev flow (`bin/homer`), where cwd already is
 *      the repo.
 *
 * Pure so it can be unit-tested without a real process. Each window records the
 * result as its own launch context (ADR 0005), so a second `homer` from a
 * different repo opens a window that resolves against that repo — the earlier
 * single-window limitation (one repo for the whole app) no longer applies.
 */
export function resolveRepoPath(
  argv: string[],
  env: Record<string, string | undefined>,
  cwd: string
): string {
  const flag = argv.find(a => a.startsWith(REPO_FLAG))
  const fromFlag = flag?.slice(REPO_FLAG.length)
  if (fromFlag) return fromFlag
  if (env.DV_REPO) return env.DV_REPO
  return cwd
}

/** Decode the `--pr=` launch flag back into a target (used by the preload). */
export function parsePrFlag(argv: string[]): PrTarget | null {
  const flag = argv.find(a => a.startsWith(PR_FLAG))
  if (!flag) return null
  const [owner, repo, num] = flag.slice(PR_FLAG.length).split('/')
  if (!owner || !repo || !num || Number.isNaN(Number(num))) return null
  return { owner, repo, number: Number(num) }
}
