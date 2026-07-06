import { useEffect, useState } from 'react'
import type { PrTarget } from '../../preload'

/** How often to re-check the PR's head SHA. Focus also triggers a check. */
const POLL_MS = 60_000

export interface Staleness {
  /** True once the PR's live head SHA has moved past the session's. */
  stale: boolean
  /** The PR's current head SHA as last observed (null before the first check). */
  latestHeadSha: string | null
  /** New-commit count since the session's head SHA, if the compare succeeded. */
  newCommits: number | null
}

const FRESH: Staleness = { stale: false, latestHeadSha: null, newCommits: null }

/**
 * Detect when the PR gains new commits mid-session (ADR 0001, extended).
 *
 * Polls the PR's current head SHA — on an interval and on window focus — and
 * compares it to `sessionHeadSha`, the SHA the session's Guide, Diff Snapshot,
 * and Line Comments were built at. This hook only *observes*: on a change it
 * reports staleness (with a best-effort new-commit count) so the UI can offer an
 * explicit Refresh. It never mutates the Guide, diff, or comments — Refresh is
 * always the reviewer's choice, never a mid-session rug-pull.
 *
 * Additive and offline-tolerant: a failed poll (offline, auth blip) is swallowed
 * and retried, so staleness detection never disrupts Activity or Diff.
 */
export function usePrStaleness(target: PrTarget, sessionHeadSha: string | null): Staleness {
  const [state, setState] = useState<Staleness>(FRESH)

  useEffect(() => {
    if (!sessionHeadSha) return
    let cancelled = false

    const check = async (): Promise<void> => {
      try {
        const pr = await window.api.githubGetPR(target)
        if (cancelled) return
        if (pr.headSha === sessionHeadSha) {
          setState({ stale: false, latestHeadSha: pr.headSha, newCommits: null })
          return
        }
        // Head moved — count the new commits (best-effort; the banner degrades
        // to "new commits" if the compare can't be fetched).
        let newCommits: number | null = null
        try {
          newCommits = await window.api.githubCommitsAhead(target, sessionHeadSha, pr.headSha)
        } catch {
          newCommits = null
        }
        if (!cancelled) setState({ stale: true, latestHeadSha: pr.headSha, newCommits })
      } catch {
        // Offline / transient — leave the last state and try again next tick.
      }
    }

    setState(FRESH)
    void check()
    const id = setInterval(() => void check(), POLL_MS)
    const onFocus = (): void => void check()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [target.owner, target.repo, target.number, sessionHeadSha])

  return state
}
