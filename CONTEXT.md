# Diff Viewer

A fast, local-first diff surface for reading code — whether the code is uncommitted work in progress, a teammate's GitHub PR, or a branch viewed over time. The same review workflow runs against multiple destinations (GitHub, AI agents).

## Language

**Review**:
A batch of feedback containing zero or more **Line Comments** plus an overall summary, drafted as **Pending** and then submitted as a unit to a **Destination**.
_Avoid_: "Comment thread", "review session" (use **Review**).

**Line Comment**:
A note attached to a specific file + line range, belonging to exactly one **Review**.
_Avoid_: "Inline comment", "PR comment" (use **Line Comment**; the **Destination** determines where it ends up).

**Pending Review**:
A **Review** in its in-progress state — drafted locally, not yet submitted. Persisted to local SQLite so it survives app restart. Keyed by (repo, **Diff Source** spec).

**Diff Snapshot**:
The frozen state of a **Diff Source** captured when a **Pending Review** is started. **Line Comments** anchor to the **Diff Snapshot**, not to the live diff. Users explicitly "refresh" to re-snapshot, with a warning that comments anchored to gone-or-moved content may be lost.

**Destination**:
Where a submitted **Review** is sent. V0 destinations: **GitHub PR**, **Agent** (via clipboard).
_Avoid_: "Target", "channel".

**Diff Source**:
The thing being reviewed — the source of the diff content. In scope for V0: working tree vs HEAD, staged vs HEAD, working tree vs staged, branch vs base, arbitrary commit range, single commit, and GitHub PR. Each **Diff Source** has different stability properties (a GitHub PR's diff or a commit range is stable across an app restart; a working tree's is not).

**Branch Playback** (out of V0):
A scrubber UX that walks a branch commit-by-commit, updating the diff as you move through history. Use case is satisfied in V0 by opening an old PR.

**Window**:
A single-purpose surface owned by the app. Each **Window** is scoped to exactly one of: the **PR Inbox**, a local repo (the cwd from a CLI launch), or a single **Review** in progress. Multiple **Windows** are expected to be open simultaneously.

**PR Inbox**:
A multi-repo list of GitHub PRs the user is involved in, organized into "Mine," "Review requested," and "Recently merged." Polls on focus and every 60s while focused.

**Local Mode**:
A **Window** scoped to a single repo, opened by invoking the app's CLI from a terminal in that repo's working directory. Does not browse other repos.

**GitHub Auth**:
Delegated to the `gh` CLI — the app shells out to it for tokens and API calls. The app must surface an explicit status (authenticated as @user / `gh` not installed / `gh` not authenticated) so the user understands the dependency.

## Relationships

- A **Review** contains zero or more **Line Comments** and exactly one summary
- A **Review** targets exactly one **Diff Source** and is submitted to exactly one **Destination**
- A **Pending Review** becomes a submitted **Review** when sent to a **Destination**
- The same **Review** workflow (draft → submit) applies regardless of **Destination**

## Example dialogue

> **Dev:** "When I'm reviewing my own working tree before committing, where do the **Line Comments** go when I submit?"
> **Product owner:** "If the **Destination** is **Agent**, they get formatted into a prompt and copied to clipboard. If the **Destination** is yourself — i.e. you're just reading and noting — we haven't decided whether a **Review** even needs to be submitted; might just stay **Pending** indefinitely or get discarded."

## V0 Scope

**In:**
- **PR Inbox** window with three sections (Mine / Review requested / Recently merged), poll-on-focus + 60s
- **PR Review** window: Pierre diffs + tree, read description and existing threads, draft **Pending Review** with **Line Comments** + summary + replies to existing threads, submit as approve/request-changes/comment
- **Local Mode** window: diff source picker (working tree, branch vs base, arbitrary refs), **Diff Snapshot** on review start, submit to **Agent** **Destination** via clipboard
- `gh` CLI auth with explicit status indicator
- Keyboard shortcuts for next/prev file, next/prev hunk, add comment, submit review
- Tooltips on non-obvious UI
- **Pending Review** persistence in local SQLite

**Out:**
- CI status display
- Resolve / unresolve threads
- GitHub suggested edits (` ```suggestion `)
- **Branch Playback**
- Notifications
- Live agent bridges beyond clipboard
- Auto-update, code-signed install
- Settings beyond the gh-auth status

## Flagged ambiguities

- "Review" used to mean both the pending draft and the submitted artifact — resolved: **Pending Review** is the unsubmitted state, **Review** is the noun that covers both states.
- Whether a **Review** can have a **Destination** of "self" (i.e. notes-on-code with no submission) is unresolved.
