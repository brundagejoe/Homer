# Single window with in-app navigation

> **Amended by ADR 0005 (one window per PR).** The multi-monitor case this ADR
> accepted as a cost was later revisited: Homer now opens one window per PR
> (with dedup), layered on top of the in-app tab navigation described here — the
> "explicit open in new window" path this ADR pointed to as the cleaner answer.

The app owns exactly one window. Inside it you navigate between three
surfaces — the **PR Inbox**, a **PR Review**, and **Local Mode** (a
repo's working changes) — with an "‹ Inbox" back button and, from the
inbox, a "local changes" entry. There is one CLI command, `homer`. Where it
lands depends on where it's launched: a PR URL opens that PR; a repo with
active changes opens its Code view; anything else (a clean repo, no repo)
opens the inbox. A second `homer` invocation focuses the existing window and
navigates it in place rather than spawning a new one.

The alternative was one `BrowserWindow` per surface — the inbox, each PR,
and each local repo in its own window, with navigation handled by OS
window management — on the theory that review is a multi-monitor
activity. In practice the single operator flow — glance at the inbox,
open a PR, come back — was what we actually did, and juggling multiple
CLI entry points plus per-purpose window dedup maps was more machinery
than that flow needed. One window keeps navigation in the renderer and
drops the `inboxWindow`/`localWindows`/`prWindows` bookkeeping and the
`window:open-pr-review` IPC.

The cost is the multi-monitor case: you can no longer put the inbox on
one screen and a PR on another. We accept that — **Pending Reviews**
persist to disk keyed by repo/PR, so navigating away and back never loses
a draft, which removes the main reason separate windows would exist ("one
window = one thing, no cross-talk"). If side-by-side viewing becomes a
real need, the cleaner answer is an explicit "open in new window" action
layered on top of in-app navigation, not a return to purpose-per-window
launches.
