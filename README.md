# Diff Viewer

A fast, usable diff surface for reading code — whether the code is uncommitted work in progress, a teammate's GitHub PR, or an arbitrary comparison of git refs. One review workflow, multiple destinations (GitHub, AI agents).

## Why this exists

- GitHub.com's PR UI is slow enough to be friction in daily review.
- [Pierre](https://pierre.computer) makes the experience we want, but their product is a PR platform — our team is on GitHub and isn't moving, and Pierre doesn't do local diff review.
- Their open-source rendering primitives ([`@pierre/diffs`](https://diffs.com), [`@pierre/trees`](https://trees.software)) are exactly what's missing. The rest of the app — gh auth, git operations, pending-review state, GitHub API, multi-window orchestration, CLI launcher — is built here.

## What it does

- **PR Inbox** — multi-repo list of open PRs you authored or are assigned to review, plus recently merged.
- **PR Review** — open a PR, read description and existing threads, draft a Pending Review with line comments and replies, submit as approve / request changes / comment.
- **Local Mode** — launched from a terminal in any git repo. Diff against the working tree, a branch base, or arbitrary refs. Submit your review to clipboard (formatted for an AI agent) or just keep it for yourself.

A Pending Review is a batched draft — all comments go out together, just like a GitHub review. The same primitive works whether the destination is a PR or an agent.

## Design docs

- [`CONTEXT.md`](./CONTEXT.md) — canonical domain language. Read this first.
- [`docs/adr/`](./docs/adr/) — load-bearing decisions:
  - [0001](./docs/adr/0001-snapshot-semantics-for-pending-reviews.md) — Pending Reviews use diff-snapshot semantics, not content-anchoring.
  - [0002](./docs/adr/0002-multi-window-one-purpose.md) — Multi-window architecture, one purpose per window.

## Stack

- Electron via [electron-vite](https://electron-vite.org)
- React + TypeScript
- [Bun](https://bun.sh) as the package manager
- [`@pierre/diffs`](https://diffs.com) and [`@pierre/trees`](https://trees.software) for rendering
- [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) for Pending Review persistence
- [`@octokit/rest`](https://github.com/octokit/rest.js) for the GitHub API
- Shell out to `git` for local operations
- `gh` CLI for auth (the app delegates and surfaces an explicit status)

## Status

Pre-V0. Design is locked; implementation has not started.
