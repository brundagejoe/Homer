/**
 * Pure navigation math for the Diff view's keyboard shortcuts. Kept free
 * of React and Pierre so it can be tested through its public interface:
 * given a cursor + a set of things to move through, where does the next
 * move land. The Diff view supplies parsed diff metadata and wires the
 * results into file selection / Pierre's scroll API.
 */

export interface HunkTarget {
  path: string
  /** Line to scroll to, in the file version named by `side`. */
  lineNumber: number
  side: 'additions' | 'deletions'
}

/** The slice of a parsed hunk this module needs to place a scroll target. */
export interface HunkInfo {
  /** First line number in the new file version (`+X` in the hunk header). */
  additionStart: number
  /** Count of `+`-prefixed lines; 0 means the hunk is a pure deletion. */
  additionLines: number
  /** First line number in the old file version (`-X` in the hunk header). */
  deletionStart: number
}

export interface FileHunks {
  path: string
  hunks: HunkInfo[]
}

/**
 * Move a cursor one step in `dir` and clamp to `[0, length - 1]`. An
 * unset cursor (`-1`) stepped forward lands on the first item; an empty
 * collection stays unset. Clamps at the ends rather than wrapping so
 * repeated presses at a boundary are a no-op, not a jump to the far end.
 */
export function clampStep(current: number, length: number, dir: 1 | -1): number {
  if (length <= 0) return -1
  const next = current + dir
  if (next < 0) return 0
  if (next > length - 1) return length - 1
  return next
}

/**
 * Flatten parsed file diffs into one ordered scroll target per hunk, in
 * file-then-hunk order. Each hunk anchors to its new-side start line;
 * pure-deletion hunks (no added lines) have no new-side line, so they
 * anchor to the old side instead.
 */
export function buildHunkTargets(files: FileHunks[]): HunkTarget[] {
  const targets: HunkTarget[] = []
  for (const file of files) {
    for (const hunk of file.hunks) {
      if (hunk.additionLines > 0) {
        targets.push({ path: file.path, lineNumber: hunk.additionStart, side: 'additions' })
      } else {
        targets.push({ path: file.path, lineNumber: hunk.deletionStart, side: 'deletions' })
      }
    }
  }
  return targets
}

/** Index of the first hunk target in `path`, or -1 if the file has none. */
export function firstHunkIndexForPath(targets: readonly HunkTarget[], path: string): number {
  return targets.findIndex(t => t.path === path)
}
