/**
 * CoverageMapper — the shared, pure reconciliation of the Guide's Coverage
 * Map against the diff's changed hunks.
 *
 * The Guide is deliberately selective: it narrates the arc, not every hunk.
 * The Diff view is the completeness backstop — it flags every changed hunk
 * the Guide did NOT narrate, so nothing hides. This module owns exactly that
 * one decision: given the diff's changed hunks and the Coverage Map declared
 * at `finalize_guide`, which hunks are un-narrated?
 *
 * It has no knowledge of Pierre, React, IPC, or git — callers hand it plain
 * hunks and get the un-narrated subset back. Prior-art style: `split-patch.ts`.
 */

import type { CoverageMap, LineRange } from './guide-schema'

/**
 * A changed hunk from the diff, as far as reconciliation cares: a file path
 * and the line span the change occupies. Callers may pass richer objects (an
 * annotation anchor, a side) — the un-narrated subset is returned as the same
 * objects, so placement metadata rides along untouched.
 */
export interface DiffHunk {
  path: string
  lineRange: LineRange
}

/**
 * Reconcile the diff's changed `hunks` against the Guide's `coverage` and
 * return the subset that is UN-narrated — the changes the Diff view must flag.
 *
 * Matching semantics (kept deliberately fuzzy — the Coverage Map is the
 * Agent's approximate self-report, not an exact index):
 *  - A diff hunk counts as NARRATED iff some entry in `coverage.narrated` has
 *    the same `path` AND a `lineRange` that OVERLAPS the hunk's `lineRange`
 *    (inclusive intersection). Overlap — not exact match — makes it robust to
 *    the Agent declaring slightly loose ranges.
 *  - Everything else is un-narrated and returned, in input order.
 *
 * Deliberate choices:
 *  - Only `narrated` drives the result; `omitted` is not consulted. The diff
 *    is ground truth, so a hunk is flagged unless the Guide can PROVE it was
 *    narrated. This means a hunk the Agent forgot to list in either list is
 *    still flagged — the backstop never under-flags a real change.
 *  - Narrated entries pointing outside the changed files (or at line ranges
 *    that match no hunk) simply match nothing and are ignored — they can never
 *    suppress a flag on a real change.
 *  - `coverage === null` (Guide not finalized yet, or generation failed) flags
 *    EVERY hunk: with no proof of narration, the completeness-first default is
 *    "nothing hides".
 */
export function findUnnarratedHunks<H extends DiffHunk>(
  hunks: readonly H[],
  coverage: CoverageMap | null
): H[] {
  if (!coverage) return [...hunks]
  const narrated = coverage.narrated
  return hunks.filter(h => !narrated.some(n => n.path === h.path && overlaps(n.lineRange, h.lineRange)))
}

/** Inclusive intersection of two line spans. */
function overlaps(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && b.start <= a.end
}
