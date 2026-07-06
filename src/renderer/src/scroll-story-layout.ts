/**
 * ScrollStory's pure layout decisions — the small, deterministic pieces of the
 * scrollytelling logic that don't need the DOM. They are split out from
 * `ScrollStory.tsx` so they can be unit-tested in isolation while the observer
 * wiring and sticky choreography around them stay behind the module's interface
 * and are validated by hand (HITL). Nothing here touches React, the DOM, or
 * scroll offsets.
 */

/** Which column of a Section is pinned (`sticky`) while the other drives scroll. */
export type PinSide = 'prose' | 'code'

/**
 * Decide which column pins: the shorter one stays put while the taller one
 * drives the scroll. Ties keep the narrative pinned (the classic scrollytelling
 * default — prose holds while code moves). Heights are the columns' natural
 * (unpinned) heights, so the choice never feeds back into the measurement.
 */
export function choosePinSide({
  proseHeight,
  codeHeight
}: {
  proseHeight: number
  codeHeight: number
}): PinSide {
  return codeHeight < proseHeight ? 'code' : 'prose'
}

/**
 * Reduce the set of Section ordinals currently crossing the progress line into
 * the single "active" ordinal. When a boundary momentarily overlaps two
 * sections we take the furthest-down one so scrolling advances promptly; when
 * the line sits in a gap between sections (nothing intersecting) we hold the
 * previous ordinal rather than flicker. Order-independent so it accepts a Set
 * straight from the IntersectionObserver.
 */
export function resolveActiveOrdinal(intersecting: Iterable<number>, previous: number): number {
  let max = -Infinity
  for (const ordinal of intersecting) {
    if (ordinal > max) max = ordinal
  }
  return max === -Infinity ? previous : max
}

/** Render the soft `NN / NN` progress indicator, zero-padded to two digits. */
export function formatProgress(current: number, total: number): string {
  const pad = (n: number): string => String(Math.max(0, n)).padStart(2, '0')
  return `${pad(current)} / ${pad(total)}`
}
