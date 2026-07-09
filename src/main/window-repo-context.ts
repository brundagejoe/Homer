/**
 * Per-window launch repo context, keyed by `webContents.id`.
 *
 * Each window is launched for a repo — the `homer` invocation's cwd, or the
 * `--repo=` the global shim captures. With multiple windows open, Guide
 * generation must resolve a PR's source repo against **the requesting window's**
 * launch context, not the main process's `process.argv` (which is fixed at the
 * first launch and shared by every window). The `guide:generate` handler reads
 * the requesting window's context from here via `e.sender.id`.
 *
 * Holds only resolved absolute paths and plain numbers — no Electron
 * references — so it is a pure map that can be unit-tested.
 */
class WindowRepoContext {
  private readonly byWebContentsId = new Map<number, string>()

  /** Record the launch repo path for a window's `webContents.id`. */
  set(webContentsId: number, repoPath: string): void {
    this.byWebContentsId.set(webContentsId, repoPath)
  }

  /** The launch repo path for a window, or undefined if none was recorded. */
  get(webContentsId: number): string | undefined {
    return this.byWebContentsId.get(webContentsId)
  }

  /** Forget a window's context on teardown (no-op if absent). */
  delete(webContentsId: number): void {
    this.byWebContentsId.delete(webContentsId)
  }
}

/** Process-wide singleton — set by the app entry, read by the IPC handler. */
export const windowRepoContext = new WindowRepoContext()
