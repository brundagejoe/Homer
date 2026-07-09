# One window per PR

Amends ADR 0003 (single window with in-app navigation).

Homer opens one window per PR. `homer <pr-url>` opens a new window for that
PR; a second `homer` for a PR that is **already** open focuses its existing
window rather than opening a duplicate (dedup on PR identity —
`owner/repo/number`). A launch without a PR URL opens (or focuses) a single
"paste a PR URL" window. Two windows can now sit side by side — a PR on one
monitor, another PR on the next — which the single-window model could not do.

The app stays **one process with many windows**, not many processes: the
single-instance lock is kept, so a second `homer` hands its argv (and the
shell's cwd) to the running instance, which spawns the window there. This keeps
the shared services — the PR Worktree index, the Guide cache, the Pending
Review store, one `gh`/GitHub client — in one process, where their keys already
scope everything per repo/PR/SHA. Dropping the lock for separate processes would
have put those shared on-disk caches into contention for no benefit.

Most of the machinery was already per-window. `WindowGenerations` keys the
in-flight Guide generation by `webContents.id`, the preload reads its own
`--pr=` from per-window `additionalArguments`, and the streaming IPC targets
`e.sender`. Three things changed:

- **The reuse policy.** The `mainWindow` singleton became a `Map` keyed by PR;
  `openOrNavigate` focuses an open window or creates a new one. The now-dead
  `app:navigate` IPC (which pointed the one window at a different PR in place)
  was removed — a window's PR is fixed for its lifetime.
- **Per-window repo context.** Guide generation resolved the PR's source repo
  from the main process's `process.argv` — global, fixed at first launch (the
  known limitation noted in `launch.ts`). Each window now carries its own
  `--repo=` (via `additionalArguments`), recorded in `windowRepoContext` by
  `webContents.id`; `guide:generate` resolves against the requesting window's
  context. Two windows launched from different repos each generate correctly.
- **Bounds.** The saved size is still shared, but each new window cascades
  down-right from it so windows don't stack exactly on top of one another. The
  first window opens unshifted, so the common single-window case is unchanged.

The cost is per-window worktree lifecycle: `before-quit` still releases all PR
Worktrees on quit rather than refcounting a shared worktree as individual
windows close. Two windows on the same PR share one worktree (keyed by PR), and
closing one doesn't release it early — acceptable, since the cache is cleaned up
wholesale on quit and by the startup sweep. Refcounted per-window release is a
later refinement if it ever matters.
