/**
 * External per-comment draft-body store.
 *
 * The in-progress text of an inline comment editor lives here, keyed by comment
 * id — NOT in the Window-level review draft. Writing to the shared draft on every
 * keystroke re-renders every FileDiff panel in the Guide (each non-virtualized),
 * which makes typing crawl. Here a keystroke notifies only the subscribers of that
 * one id (the open editor), so nothing else re-renders. And because the text lives
 * outside React, it survives Pierre re-rendering / re-creating the annotation node
 * (the editor re-reads the current value on mount).
 *
 * The body is flushed into the review draft only on commit; the entry is cleared
 * on commit or cancel. Consumed via `useSyncExternalStore` in `PendingCommentEditor`.
 */
const bodies = new Map<string, string>()
const listeners = new Map<string, Set<() => void>>()

/** Current in-progress body for `id`, or `fallback` when nothing's been typed yet. */
export function getDraftBody(id: string, fallback: string): string {
  const stored = bodies.get(id)
  return stored !== undefined ? stored : fallback
}

/** Record the in-progress body and notify only this id's subscribers. */
export function setDraftBody(id: string, body: string): void {
  bodies.set(id, body)
  listeners.get(id)?.forEach(fn => fn())
}

/** Drop the in-progress body (on commit or cancel). */
export function clearDraftBody(id: string): void {
  bodies.delete(id)
}

/** Subscribe to changes for one comment id. Returns an unsubscribe. */
export function subscribeDraftBody(id: string, fn: () => void): () => void {
  let set = listeners.get(id)
  if (!set) {
    set = new Set()
    listeners.set(id, set)
  }
  set.add(fn)
  return () => {
    set.delete(fn)
    if (set.size === 0) listeners.delete(id)
  }
}
