import type { LineRange } from './guide-schema'

/**
 * Slice a single file's unified-diff patch down to just the hunks whose NEW-side
 * span overlaps one of `ranges`, returning a still-valid patch (preamble + kept
 * hunks). This backs the Guide's "one panel per file per Section" rendering: a
 * Section may reference the same file at several line spans, but each reference
 * resolves to the file's ENTIRE patch, so rendering every reference paints the
 * whole file repeatedly. Grouping the references by file and slicing the patch
 * to the union of their spans collapses that to one panel showing only the
 * relevant hunks.
 *
 * Why slice the PATCH TEXT rather than the parsed hunks: Pierre's `processFile`
 * computes each rendered line's number from the `@@` header and expects the
 * hunk bodies to stay internally consistent with it. Hand-narrowing Pierre's
 * already-parsed `fileDiff.hunks` breaks those invariants (null deletion/
 * addition lines → a render crash). Cutting whole hunk blocks out of the raw
 * text and re-parsing keeps every `@@` header paired with its exact body, so
 * Pierre parses a clean, self-consistent file.
 *
 * Fallbacks always return a HEADERFUL patch — never an empty or preamble-only
 * string: if `ranges` is empty, nothing overlaps, or the patch has no `@@` at
 * all, the original patch is returned unchanged.
 */

/** Matches a unified-diff hunk header, capturing the NEW-side start and count. */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

interface HunkBlock {
  /** Inclusive NEW-side line span this hunk covers. */
  start: number
  end: number
  /** The hunk's original lines (header + body), for faithful reassembly. */
  lines: string[]
}

export function slicePatchToRanges(patch: string, ranges: readonly LineRange[]): string {
  const lines = patch.split('\n')

  const firstHunk = lines.findIndex(line => HUNK_HEADER.test(line))
  // No hunks to scope, or nothing to scope to: return the patch untouched.
  if (firstHunk === -1 || ranges.length === 0) return patch

  const preamble = lines.slice(0, firstHunk)
  const hunks = parseHunks(lines, firstHunk)

  const kept = hunks.filter(h => ranges.some(r => h.start <= r.end && r.start <= h.end))
  // No hunk overlaps any range — fall back to the full patch rather than emit a
  // headerless (preamble-only) string Pierre couldn't render.
  if (kept.length === 0) return patch

  return [...preamble, ...kept.flatMap(h => h.lines)].join('\n')
}

/** Break the post-preamble lines into hunk blocks, each `@@` header to the next. */
function parseHunks(lines: string[], firstHunk: number): HunkBlock[] {
  const hunks: HunkBlock[] = []
  let current: HunkBlock | null = null

  for (let i = firstHunk; i < lines.length; i++) {
    const match = lines[i].match(HUNK_HEADER)
    if (match) {
      const newStart = Number(match[1])
      // Absent count means 1 line; a 0 count (pure deletion) still anchors at
      // its new-side start, so span it as a single line there.
      const newCount = match[2] === undefined ? 1 : Number(match[2])
      const span = Math.max(newCount, 1)
      current = { start: newStart, end: newStart + span - 1, lines: [lines[i]] }
      hunks.push(current)
    } else if (current) {
      current.lines.push(lines[i])
    }
  }

  return hunks
}
