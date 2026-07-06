/**
 * Reconcile a Pending Review's Line Comments across a re-snapshot (ADR 0001,
 * extended for Refresh). When the PR gains new commits and the reviewer chooses
 * to Refresh, the frozen Diff Snapshot is replaced. A Line Comment anchors to
 * the snapshot it was drafted against, not to live file content, so after the
 * swap each comment is either:
 *
 *  - **carried** — the code it anchors to is byte-for-byte the same at the same
 *    path + side + line number in the new snapshot, or
 *  - **orphaned** — that code changed, moved, or vanished; the comment no longer
 *    anchors cleanly and must be surfaced with a warning, never silently dropped
 *    or silently re-placed.
 *
 * This is deliberately strict positional-content matching, NOT robust
 * re-location: ADR 0001 chose snapshot semantics precisely because
 * mis-anchoring is worse than an explicit "this one didn't survive" warning. A
 * line whose content is unchanged but whose line number shifted is treated as an
 * orphan — we never guess a new position.
 *
 * Pure and dependency-free (no preload/store coupling): it works on the minimal
 * structural shapes below, so both the renderer's draft machine and any test can
 * drive it directly.
 */

/** The anchor fields of a Line Comment this reconciliation needs. */
export interface AnchoredComment {
  path: string
  /** Last line of the anchor range (or the single line). */
  lineNumber: number
  side: 'old' | 'new'
  /** First line of a multi-line range, if any. */
  startLineNumber?: number
  startSide?: 'old' | 'new'
}

/** The subset of a Diff Snapshot needed to look up anchored line content. */
export interface SnapshotLike {
  files: { path: string; patch: string }[]
}

export interface Reconciliation<C> {
  /** Comments that still anchor cleanly; keep them on the new snapshot. */
  carried: C[]
  /** Comments whose anchor no longer resolves; warn, don't drop silently. */
  orphaned: C[]
}

/** The per-side line-number → content maps parsed from one file's patch. */
interface LineIndex {
  old: Map<number, string>
  new: Map<number, string>
}

/**
 * Walk a unified diff for one file and record, per side, the content at each
 * line number. Context lines belong to both sides; `+` to the new side, `-` to
 * the old side. Header/metadata lines are skipped. The stored content excludes
 * the leading diff marker so a line that was added in one snapshot and is
 * context in another still matches by its actual code text.
 */
function indexPatch(patch: string): LineIndex {
  const index: LineIndex = { old: new Map(), new: new Map() }
  let oldLine = 0
  let newLine = 0
  let inHunk = false

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) {
        oldLine = Number(m[1])
        newLine = Number(m[2])
        inHunk = true
      }
      continue
    }
    if (!inHunk) continue
    // "\ No newline at end of file" and any stray empty trailer aren't content.
    if (line.startsWith('\\')) continue
    const marker = line[0]
    const text = line.slice(1)
    if (marker === '+') {
      index.new.set(newLine, text)
      newLine++
    } else if (marker === '-') {
      index.old.set(oldLine, text)
      oldLine++
    } else if (marker === ' ') {
      index.old.set(oldLine, text)
      index.new.set(newLine, text)
      oldLine++
      newLine++
    }
    // Any other leading char inside a hunk (shouldn't occur) is ignored.
  }
  return index
}

function buildIndex(snapshot: SnapshotLike): Map<string, LineIndex> {
  const byPath = new Map<string, LineIndex>()
  for (const file of snapshot.files) byPath.set(file.path, indexPatch(file.patch))
  return byPath
}

/** The (side, line) endpoints a comment's stored anchor pins to. */
function anchorPoints(comment: AnchoredComment): { side: 'old' | 'new'; line: number }[] {
  const points = [{ side: comment.side, line: comment.lineNumber }]
  if (comment.startLineNumber != null) {
    points.push({ side: comment.startSide ?? comment.side, line: comment.startLineNumber })
  }
  return points
}

function contentAt(index: LineIndex | undefined, side: 'old' | 'new', line: number): string | undefined {
  return index?.[side].get(line)
}

/**
 * Given the comments, the snapshot they were drafted against, and the fresh
 * snapshot, partition the comments into survivors and orphans. A comment
 * survives iff every endpoint of its anchor resolves to identical content in
 * both snapshots at the same path/side/line.
 */
export function reconcileComments<C extends AnchoredComment>(args: {
  comments: readonly C[]
  oldSnapshot: SnapshotLike
  newSnapshot: SnapshotLike
}): Reconciliation<C> {
  const oldIndex = buildIndex(args.oldSnapshot)
  const newIndex = buildIndex(args.newSnapshot)

  const carried: C[] = []
  const orphaned: C[] = []

  for (const comment of args.comments) {
    const before = oldIndex.get(comment.path)
    const after = newIndex.get(comment.path)
    const survives = anchorPoints(comment).every(({ side, line }) => {
      const old = contentAt(before, side, line)
      const now = contentAt(after, side, line)
      // Must have been resolvable in the old snapshot AND resolve to the same
      // content at the same position in the new one. Undefined either side (file
      // gone, line no longer in the diff, or shifted position) → orphan.
      return old !== undefined && old === now
    })
    if (survives) carried.push(comment)
    else orphaned.push(comment)
  }

  return { carried, orphaned }
}
