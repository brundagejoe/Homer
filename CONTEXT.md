# Guided PR Review

A local, reviewer-side tool for reviewing someone else's GitHub PR. Launched from the CLI inside a repo with a PR URL, it runs an autonomous Claude **Agent** against the PR and generates a **Guide** — a scrollytelling story of small **Sections** that walk you through the intent and context of the change — so that when you finish, you feel like an owner of the code. Then you review the full diff normally and submit one batched **Review** to GitHub.

This product replaces the earlier local diff-viewer. The Electron shell, `gh` auth delegation, Pierre diff/tree renderers, the **Review** / **Line Comment** model, and SQLite persistence carry over; the goals and top-level views do not.

**Product name: Homer** (the storyteller — Homer tells the story of a PR). The CLI command is `homer`. macOS bundle id: `com.brundagejoe.homer`.

## Language

**Guide**:
The generated narrative for one PR: an ordered sequence of **Sections** presented as a single scrollytelling story. Derived, disposable, cached per PR head SHA — never hand-authored, always regenerable from the **Agent**.
_Avoid_: "story view", "walkthrough" (use **Guide**; a single unit is a **Section**).

**Section**:
One step of the **Guide** — a title, an ordinal (`01/05`), a tight prose explanation, and 1..N **Code References**. Carries a `kind` discriminator (`code` only in V1; leaves room for `diagram` etc.). Deliberately small and digestible.

**Code Reference**:
A pointer from a **Section** into the code: `{ path, lineRange, renderMode: 'diff' | 'full', kind }`. May point at **changed** or **unchanged** code. The **Guide** is a many-to-many narrative overlay, not a partition — a **Code Reference** may appear in zero, one, or many **Sections**, and trivial changes may appear in none.

**Coverage Map**:
Declared by the **Agent** when it finishes (`finalize_guide`): which changed hunks the **Guide** narrated vs. left out. Powers the **Diff** view's flagging of un-narrated changes.

**Agent**:
The autonomous worker that reads the PR and produces the **Guide**. V1 is the user's locally-installed `claude` CLI (`--bare`), run against the **PR Worktree** with read/grep/bash tools, on the user's own subscription. The app spawns it and **hosts the tools it calls** (`emit_section`, `finalize_guide`); the app is the parent, the **Agent** is the worker. Model defaults to Opus-class, configurable.
_Avoid_: "the AI", "the model" (use **Agent**).

**PR Worktree**:
A dedicated `git worktree` checked out at the PR head SHA, in an app-owned cache dir outside the user's repo. Gives the **Agent** full-repo context *as of the PR* without touching the reviewer's working tree. Kept alive for the session; cleaned up on session close, on startup sweep (`git worktree prune`), by LRU disk cap, and by a manual clear action.

**View**:
One of the three tabs the single **Window** navigates between — **Activity**, **Guide**, **Diff**. Free navigation; lands on **Activity**. **Activity** and **Diff** do not depend on the **Agent** — it is additive, never a single point of failure.

**Activity**:
A **View** rendering the PR like its GitHub landing page — title, body, author, base ← head refs, and the existing conversation / review threads.

**Diff**:
A **View** giving full GitHub-style diff review (Pierre diffs + tree) over the whole PR. Full **Line Comment** commenting. Flags changes the **Guide** did not narrate (via the **Coverage Map**) as the completeness backstop; the **Review** cannot be finalized without this pass.

**Review**:
A batch of feedback containing zero or more **Line Comments** plus an overall summary, drafted as **Pending** and then submitted as a unit as approve / request-changes / comment.
_Avoid_: "comment thread", "review session" (use **Review**).

**Line Comment**:
A note attached to a specific file + line range, belonging to exactly one **Review**. Anchored to the **Diff Snapshot**. In the **Guide**, allowed only on **changed** lines (context references are read-only there); in **Diff**, allowed anywhere GitHub permits.
_Avoid_: "inline comment", "PR comment".

**Pending Review**:
A **Review** in its in-progress state — drafted locally, not yet submitted. Durable: persisted to local SQLite, survives app restart. Keyed by (repo, PR). The one piece of state that is authored by a human and cannot be regenerated.

**Diff Snapshot**:
The frozen state of the PR captured when a **Pending Review** is started (at a head SHA). **Line Comments** anchor to the **Diff Snapshot**, not the live PR. When the PR gains new commits, a banner offers an explicit **Refresh**: re-fetch, re-materialize the **PR Worktree**, regenerate the **Guide**, and re-snapshot — survivors carry, orphaned **Line Comments** are warned about. Never a mid-session rug-pull. (ADR 0001, extended to also regenerate the **Guide**.)

**Destination**:
Where a submitted **Review** is sent. V1: **GitHub PR** only.

**GitHub Auth**:
Delegated to the `gh` CLI — the app shells out for tokens and API calls, and surfaces an explicit status (authenticated as @user / `gh` not installed / `gh` not authenticated).

## Relationships

- A **Guide** is an ordered sequence of **Sections**; a **Section** has 1..N **Code References**
- A **Code Reference** may belong to zero, one, or many **Sections** (many-to-many; not a partition of the diff)
- A **Guide** is derived from one PR at one head SHA and is cached/disposable; a **Pending Review** is durable
- A **Review** contains zero or more **Line Comments** and exactly one summary, and is submitted to the **GitHub PR** **Destination**
- The same **Pending Review** spans all three **Views**; **Line Comments** made in **Guide** and **Diff** submit together as one **Review**

## Example dialogue

> **Dev:** "The **Guide** skipped a one-line change that actually matters. How do I catch that as the reviewer?"
> **Product owner:** "The **Guide** is deliberately non-exhaustive — it narrates the arc, not every hunk. The **Diff** view is the backstop: it flags every change the **Coverage Map** says wasn't narrated, and you can't finalize the **Review** until you've done the **Diff** pass. The story is allowed to be selective *because* the diff pass guarantees nothing hides."

## V1 Scope

**In:**
- CLI launch inside a repo with a PR URL → single **Window** with `Activity · Guide · Diff` tabs, free nav, lands on **Activity**
- **Agent** = local `claude` CLI (`--bare`, subscription auth, Opus-class default, configurable), spawned by the app against the **PR Worktree**; streams **Sections** via `emit_section` + `finalize_guide`
- **PR Worktree** at head SHA with full cleanup (session close + startup sweep + LRU + manual)
- **Guide** cached per head SHA; auto-generates on launch, streams into the **Guide** tab while the user reads **Activity**; agent error → retry state, **Activity**/**Diff** unaffected
- **Guide** scrollytelling in a dedicated, decoupled scroll module: continuous scroll, shorter column pins (CSS `sticky`, side via `ResizeObserver`), `IntersectionObserver` progress, soft indicator, no hard snap
- **Sections** capped (~≤12) and tight; huge PRs degrade honestly and lean on **Diff** + **Coverage Map**
- **Diff** view: full Pierre diff review, full **Line Comment** commenting, un-narrated-change flagging as required completeness pass
- **Pending Review** (durable, SQLite): **Line Comments** (changed-lines-only in **Guide**) + summary, submit approve/request-changes/comment to the **GitHub PR**
- **Diff Snapshot** semantics + banner-driven **Refresh** on new commits (ADR 0001, extended)
- `gh` CLI auth with explicit status; keyboard shortcuts; tooltips on non-obvious UI

**Out (room left, not built):**
- Prose↔code links inside **Sections** (fast-follow: `Section` grows an `anchors` field, scroll module grows `scrollToAnchor()`)
- Non-`code` **Section** kinds (diagrams etc.) — dispatched by `kind` to new renderers
- **Agent** prompt customization in settings ("focus on X", "tests always last")
- Multi-provider **Agents** beyond the `claude` CLI
- Resident daemon that auto-spins-up a review when you're tagged
- PR Inbox / multi-repo discovery (must have the URL)
- Additional context sources for the **Agent** (linked tracker issues, CI results, prior PRs touching the files)

## Flagged ambiguities / to verify

- Unconfirmed rumor of a June-2026 change splitting programmatic `claude -p` usage into a separate billing pool — verify on the Console usage page before betting on subscription-covered runs.
- ADR 0003 (single window, in-app navigation) still holds in shape, but its three **Views** are now `Activity · Guide · Diff`, not Inbox / PR Review / Local Mode — ADR should be updated or superseded.
