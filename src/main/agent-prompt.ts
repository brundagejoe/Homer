/**
 * The Guide-generation prompt, kept in one maintainable place.
 *
 * Splits into a fixed system prompt (the Agent's standing instructions — how to
 * build a Guide, the tool contract, the section cap, the honesty rules) and a
 * per-PR user prompt (this PR's title/body/refs and its diff). Both are pure
 * string builders with no I/O, so the wording is unit-tested and easy to tune.
 */

import type { ToolNames } from './agent-stream'

/** Soft cap on Sections — the Guide narrates the arc, not every hunk. */
export const SECTION_CAP = 12

/** How much diff text we inline before truncating and leaning on the worktree. */
export const DEFAULT_MAX_DIFF_CHARS = 120_000

/** The PR fields the user prompt needs (a subset of PullRequestDetails). */
export interface PromptPrDetails {
  title: string
  body: string
  author: string
  baseRef: string
  headRef: string
  changedFiles: number
}

/**
 * Standing instructions for the Agent: it is checked out in the PR Worktree with
 * read/grep/bash, must narrate the change as a tight, capped sequence of
 * Sections via the hosted tools, and must degrade honestly on huge PRs.
 */
export function buildSystemPrompt(names: ToolNames, sectionCap = SECTION_CAP): string {
  return `You are generating a Guide: a short, scrollytelling walkthrough that helps a reviewer understand the INTENT of a GitHub pull request before they read the full diff.

You are running inside a git worktree checked out at the PR's head commit. Use your Read, Grep, Glob and Bash tools to explore the actual code as of this PR — open the files that changed and the unchanged code they depend on, so each explanation is grounded in what the code really says.

Produce the Guide by calling two tools:

- \`${names.emitSection}\` — emit ONE Section at a time, in reading order. Each Section is:
  - \`ordinal\`: 1-based position (1, 2, 3, …).
  - \`title\`: a short, specific title.
  - \`explanation\`: tight prose in Markdown. A few sentences. No filler, no restating the diff line-by-line — explain WHY the change exists and how the pieces fit.
  - \`kind\`: always "code".
  - \`references\`: 1..N Code References, each \`{ path, lineRange: { start, end }, renderMode, kind: "code" }\`.
    - Use \`renderMode: "diff"\` for CHANGED code (shown as a diff).
    - Use \`renderMode: "full"\` for relevant UNCHANGED context the reader needs (shown as full file text).
    - Group related files into one Section when they form a single idea (e.g. a change and its test).
- \`${names.finalizeGuide}\` — call ONCE at the end with a Coverage Map: \`narrated\` and \`omitted\` arrays of \`{ path, lineRange }\` hunks, declaring which changed hunks the Guide covered and which it deliberately left out.

Rules:
- Keep the Guide to at most ${sectionCap} Sections. Fewer is better. Prioritise the load-bearing changes — the ones that carry the intent — and skip trivial or mechanical ones.
- Keep every explanation tight. The reviewer will read the full diff afterwards; the Guide is the story, not a line-by-line transcript.
- Do NOT try to narrate everything. For a large PR, cover the important arc, then in \`${names.finalizeGuide}\` honestly mark the rest as \`omitted\` — the reviewer relies on the Diff view (which flags un-narrated changes) for the long tail.
- Emit Sections as you go so they can stream to the reader; finish by calling \`${names.finalizeGuide}\` exactly once.`
}

export interface UserPromptContext {
  pr: PromptPrDetails
  diff: string
}

export interface UserPromptOptions {
  maxDiffChars?: number
}

/** The per-PR prompt: PR metadata plus the (possibly truncated) unified diff. */
export function buildUserPrompt(
  { pr, diff }: UserPromptContext,
  { maxDiffChars = DEFAULT_MAX_DIFF_CHARS }: UserPromptOptions = {}
): string {
  const body = pr.body.trim() ? pr.body.trim() : '(no description provided)'
  return `Pull request: ${pr.title}
Author: ${pr.author}
Merging ${pr.headRef} → ${pr.baseRef} (${pr.changedFiles} file${pr.changedFiles === 1 ? '' : 's'} changed)

Description:
${body}

Unified diff (base…head):
${truncateDiff(diff, maxDiffChars)}

Now explore the worktree and produce the Guide using the tools described in your instructions.`
}

/** Cap the inlined diff; note the truncation so the Agent leans on the worktree. */
function truncateDiff(diff: string, maxChars: number): string {
  if (diff.length <= maxChars) return diff
  return (
    diff.slice(0, maxChars) +
    `\n\n[diff truncated at ${maxChars} characters — ${diff.length - maxChars} more characters not shown. Read the changed files directly in the worktree for the omitted parts, and mark un-narrated hunks as omitted when you finalize.]`
  )
}
