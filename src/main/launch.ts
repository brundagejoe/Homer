import { parsePrUrl } from './pr-url'

export interface PrTarget {
  owner: string
  repo: string
  number: number
}

const PR_FLAG = '--pr='

/**
 * Resolve a launch from CLI argv: the single entry point is a GitHub PR
 * URL (`dv <pr-url>`). Returns the first argument that parses as a PR
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

/** Decode the `--pr=` launch flag back into a target (used by the preload). */
export function parsePrFlag(argv: string[]): PrTarget | null {
  const flag = argv.find(a => a.startsWith(PR_FLAG))
  if (!flag) return null
  const [owner, repo, num] = flag.slice(PR_FLAG.length).split('/')
  if (!owner || !repo || !num || Number.isNaN(Number(num))) return null
  return { owner, repo, number: Number(num) }
}
