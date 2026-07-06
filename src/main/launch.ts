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

/** Encode a resolved target as renderer launch args (a single `--pr=` flag). */
export function buildLaunchArgs(target: PrTarget | null): string[] {
  return target ? [`${PR_FLAG}${target.owner}/${target.repo}/${target.number}`] : []
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
 * Pure so it can be unit-tested without a real process. Known limitation: on a
 * second `homer` invocation the already-running window keeps the repo it was first
 * launched with (the single-instance path only re-navigates the PR) — full
 * multi-repo switching is out of scope here.
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
