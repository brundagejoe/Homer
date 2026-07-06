/**
 * Tracks the in-flight Guide generation per window so a new run (or a window
 * teardown) can cancel the previous one — no orphaned `claude` subprocess and no
 * stale stream contaminating a freshly-navigated PR.
 *
 * Keyed by an opaque numeric key (the window's `webContents.id`); holds no
 * Electron references, so it is a pure state machine that can be unit-tested.
 */
export class GenerationRegistry {
  private readonly current = new Map<number, AbortController>()

  /**
   * Begin a new generation for `key`, aborting whichever generation was
   * previously current for it. Returns the fresh controller whose signal the
   * caller threads into `generate()`.
   */
  start(key: number): AbortController {
    this.abort(key)
    const controller = new AbortController()
    this.current.set(key, controller)
    return controller
  }

  /** Abort and forget the current generation for `key` (no-op if none). */
  abort(key: number): void {
    this.current.get(key)?.abort()
    this.current.delete(key)
  }

  /**
   * Mark a generation finished. Clears it only if it is still the current one —
   * a late finish from a superseded run must not clobber the newer generation.
   */
  finish(key: number, controller: AbortController): void {
    if (this.current.get(key) === controller) this.current.delete(key)
  }
}

/** The slice of Electron's `WebContents` the window-scoped owner needs. */
export interface GenerationWindow {
  id: number
  once(event: 'destroyed', listener: () => void): void
}

/**
 * Window-scoped owner of the generation lifecycle: the one place that knows a
 * generation belongs to a window and must be aborted when that window is torn
 * down. Wraps the pure `GenerationRegistry` and wires an idempotent
 * `destroyed → abort` listener once per window, so IPC handlers do no lifecycle
 * bookkeeping of their own — they just `start(window)` / `finish(...)`.
 */
export class WindowGenerations {
  private readonly registry = new GenerationRegistry()
  private readonly wired = new Set<number>()

  /**
   * Begin a generation for `window` (aborting its previous one) and ensure the
   * window's teardown aborts whatever is in flight. Returns the fresh controller.
   */
  start(window: GenerationWindow): AbortController {
    if (!this.wired.has(window.id)) {
      this.wired.add(window.id)
      window.once('destroyed', () => {
        this.registry.abort(window.id)
        this.wired.delete(window.id)
      })
    }
    return this.registry.start(window.id)
  }

  /** Mark a generation finished (only clears if still current). */
  finish(window: GenerationWindow, controller: AbortController): void {
    this.registry.finish(window.id, controller)
  }
}
