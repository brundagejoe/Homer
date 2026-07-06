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
