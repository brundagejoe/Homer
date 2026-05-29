import type { DiffLineAnnotation } from '@pierre/diffs'
import type { InlineComment, LineComment } from '../../preload'

/**
 * Annotation payload for Pierre. Existing threads come from GitHub and
 * render read-only; pending comments are local drafts that render as an
 * editable composer. Both kinds anchor to a (path, lineNumber, side).
 */
export type AnnotationMeta =
  | { kind: 'existing'; comment: InlineComment }
  | { kind: 'pending'; comment: LineComment }

/** GitHub uses LEFT/RIGHT; our Line Comments use old/new. Both collapse
 *  to Pierre's deletions/additions gutter sides. This is the one place
 *  the translation lives. */
function inlineSide(side: InlineComment['side']): DiffLineAnnotation<AnnotationMeta>['side'] {
  return side === 'LEFT' ? 'deletions' : 'additions'
}

function pendingSide(side: LineComment['side']): DiffLineAnnotation<AnnotationMeta>['side'] {
  return side === 'old' ? 'deletions' : 'additions'
}

/**
 * Map the three kinds of Line Comment a review surface shows — existing
 * GitHub threads, comments already on the Pending Review, and in-flight
 * drafts not yet committed — into Pierre annotations keyed by file path.
 *
 * Per path, existing threads come first, then pending comments, then
 * fresh drafts, matching the order the views rendered them inline before
 * this was extracted.
 */
export function buildAnnotationMap(sources: {
  existing?: readonly InlineComment[]
  pending?: readonly LineComment[]
  drafts?: readonly LineComment[]
}): Map<string, DiffLineAnnotation<AnnotationMeta>[]> {
  const map = new Map<string, DiffLineAnnotation<AnnotationMeta>[]>()
  const push = (path: string, annotation: DiffLineAnnotation<AnnotationMeta>): void => {
    const list = map.get(path) ?? []
    list.push(annotation)
    map.set(path, list)
  }
  for (const c of sources.existing ?? []) {
    push(c.path, { side: inlineSide(c.side), lineNumber: c.lineNumber, metadata: { kind: 'existing', comment: c } })
  }
  for (const c of sources.pending ?? []) {
    push(c.path, { side: pendingSide(c.side), lineNumber: c.lineNumber, metadata: { kind: 'pending', comment: c } })
  }
  for (const c of sources.drafts ?? []) {
    push(c.path, { side: pendingSide(c.side), lineNumber: c.lineNumber, metadata: { kind: 'pending', comment: c } })
  }
  return map
}
