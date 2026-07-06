import type { CodeReference, Section } from './guide-schema'

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
