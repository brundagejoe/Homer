import type { CodeReference, LineRange, RenderMode, Section } from './guide-schema'

/**
 * Render/wire shapes for the Guide — the display-resolved types that cross the
 * IPC seam to the renderer. Kept separate from `guide-schema.ts` (which owns the
 * pure Agent contract and explicitly disclaims rendering knowledge): once the
 * generation layer resolves a Code Reference pointer to displayable content,
 * that is a rendering concern and lives here.
 */

/**
 * A Code Reference whose pointer has been resolved to displayable content by the
 * generation layer. The app is the authority on what the code actually says (it
 * re-reads it); the renderer never resolves pointers itself — it renders the
 * content it is handed. `content` is a unified patch when `renderMode` is
 * 'diff', full file text when 'full'.
 */
export interface RenderableReference extends CodeReference {
  content: string
}

/** A validated Section with its references resolved to displayable content. */
export interface RenderableSection extends Omit<Section, 'references'> {
  references: RenderableReference[]
}

/**
 * A Section's references to ONE file, coalesced into a single panel. A Section
 * may point at the same file at several spans (e.g. L23–26, L168–178, L191–198);
 * each such reference resolves to the WHOLE file's content, so rendering them
 * one-by-one paints the file repeatedly. Grouping by `path` + `renderMode`
 * yields one panel per file: `content` is that file's shared content (identical
 * across the group) and `ranges` is every span the Section pointed at, in the
 * order first seen. The panel slices `content` to the hunks overlapping `ranges`
 * (diff mode) or scrolls the first range into view (full mode).
 */
export interface ReferenceGroup {
  path: string
  renderMode: RenderMode
  kind: 'code'
  content: string
  ranges: LineRange[]
}

/**
 * Coalesce a Section's references into one group per file, keyed by `path` +
 * `renderMode`, preserving first-seen order. Each group collects its `ranges`
 * in reference order and takes `content` from the group's first reference — all
 * references to the same file resolve to identical content, so the first is
 * authoritative. Splitting on `renderMode` too keeps a diff view and a full-file
 * view of the same path as distinct panels (they render differently).
 */
export function groupReferencesByFile(refs: readonly RenderableReference[]): ReferenceGroup[] {
  const groups = new Map<string, ReferenceGroup>()
  for (const ref of refs) {
    const key = `${ref.renderMode}\0${ref.path}`
    const existing = groups.get(key)
    if (existing) {
      existing.ranges.push(ref.lineRange)
    } else {
      groups.set(key, {
        path: ref.path,
        renderMode: ref.renderMode,
        kind: 'code',
        content: ref.content,
        ranges: [ref.lineRange]
      })
    }
  }
  return [...groups.values()]
}

/**
 * Whether a Code Reference can be commented on from within the Guide.
 *
 * Line Comments authored in the Guide are allowed only on CHANGED lines —
 * i.e. on references rendered as a diff. Context references (`renderMode:
 * 'full'`) are read-only there (CONTEXT.md, Line Comment). The Diff view
 * remains the place to comment anywhere GitHub permits. This is the single
 * home for that "changed-lines-only" rule, so both the Guide's authoring
 * wiring and its tests read the boundary from one place.
 */
export function isReferenceCommentable(reference: Pick<CodeReference, 'renderMode'>): boolean {
  return reference.renderMode === 'diff'
}

/**
 * Whether Line Comment authoring is actually available on a Guide reference.
 *
 * Beyond the changed-lines-only rule (`isReferenceCommentable`), authoring is
 * gated on the diff having loaded: a fresh Pending Review freezes the diff it
 * was drafted against as its Diff Snapshot (ADR 0001). Guide references come
 * from the Agent independently of the diff fetch, so if the diff is still
 * loading — or has errored while the Guide succeeded — committing the first
 * comment would freeze an EMPTY snapshot and corrupt later Refresh/orphan
 * reconciliation. Until the diff is loaded, even changed references are
 * read-only (no gutter authoring), mirroring the Diff tab.
 */
export function isGuideAuthoringEnabled(
  reference: Pick<CodeReference, 'renderMode'>,
  diffLoaded: boolean
): boolean {
  return diffLoaded && isReferenceCommentable(reference)
}
