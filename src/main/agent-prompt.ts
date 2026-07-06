/**
 * The Guide-generation prompt, kept in one maintainable place.
 *
 * The system prompt is composed of two parts:
 *
 *  1. A FIXED **contract** — how to call `emit_section` / `finalize_guide`, the
 *     Section shape, the section cap, and the honest-coverage behavior. This is
 *     the machine contract between the Agent and the app and is NEVER
 *     user-editable, so a bad settings edit can't break generation.
 *  2. An editable **guidance** — tone, what to prioritise, style ("focus on X",
 *     "always put tests last"). The shipped default is `DEFAULT_GUIDE_GUIDANCE`;
 *     the user can override it from Settings.
 *
 * `buildSystemPrompt` composes contract + guidance (falling back to the default
 * guidance when the override is null/empty). The per-PR user prompt (title/body/
 * refs + diff) is separate. All are pure string builders with no I/O, so the
 * wording is unit-tested and easy to tune.
 */

import type { ToolNames } from './agent-stream'

/** Soft cap on Sections — the Guide narrates the arc, not every hunk. */
export const SECTION_CAP = 12

/** How much diff text we inline before truncating and leaning on the worktree. */
export const DEFAULT_MAX_DIFF_CHARS = 120_000

/**
 * The shipped default **guidance**: the editable half of the system prompt that
 * shapes tone and what the Agent prioritises. Users may override this in
 * Settings; "Reset to default" restores exactly this text. The fixed contract
 * (tools, Section shape, cap, honesty) lives in `buildContract` and is always
 * present regardless of what the guidance says.
 */
export const DEFAULT_GUIDE_GUIDANCE = `Guidance for the Guide:
- Prioritise the load-bearing changes — the ones that carry the intent — and skip trivial or mechanical ones.
- Keep every explanation tight. A few sentences. No filler, no restating the diff line-by-line — explain WHY the change exists and how the pieces fit. The reviewer will read the full diff afterwards; the Guide is the story, not a line-by-line transcript.
- Group related files into one Section when they form a single idea (e.g. a change and its test).`

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
 * The FIXED contract half of the system prompt: framing plus the exact
 * `emit_section` / `finalize_guide` tool contract, the Section shape, the
 * section cap, and the honest-coverage behavior. Not user-editable — this is
 * what keeps generation working no matter what the guidance says.
 */
function buildContract(names: ToolNames, sectionCap: number): string {
  return `You are generating a Guide: a short, scrollytelling walkthrough that helps a reviewer understand the INTENT of a GitHub pull request before they read the full diff.

You are running inside a git worktree checked out at the PR's head commit. Use your Read, Grep, Glob and Bash tools to explore the actual code as of this PR — open the files that changed and the unchanged code they depend on, so each explanation is grounded in what the code really says.

Produce the Guide by calling two tools:

- \`${names.emitSection}\` — emit ONE Section at a time, in reading order. Each Section is:
  - \`ordinal\`: 1-based position (1, 2, 3, …).
  - \`title\`: a short, specific title.
  - \`explanation\`: tight prose in Markdown explaining this part of the change.
  - \`kind\`: always "code".
  - \`references\`: 1..N Code References, each \`{ path, lineRange: { start, end }, renderMode, kind: "code" }\`.
    - Use \`renderMode: "diff"\` for CHANGED code (shown as a diff).
    - Use \`renderMode: "full"\` for relevant UNCHANGED context the reader needs (shown as full file text).
- \`${names.finalizeGuide}\` — call ONCE at the end with a Coverage Map: \`narrated\` and \`omitted\` arrays of \`{ path, lineRange }\` hunks, declaring which changed hunks the Guide covered and which it deliberately left out.

Contract:
- Keep the Guide to at most ${sectionCap} Sections. Fewer is better.
- Do NOT try to narrate everything. For a large PR, cover the important arc, then in \`${names.finalizeGuide}\` honestly mark the rest as \`omitted\` — the reviewer relies on the Diff view (which flags un-narrated changes) for the long tail.
- Emit Sections as you go so they can stream to the reader; finish by calling \`${names.finalizeGuide}\` exactly once.`
}

/**
 * Standing instructions for the Agent: the fixed contract (always present) plus
 * the guidance. Pass a custom `guidance` to override the shipped default; a
 * null/empty override falls back to `DEFAULT_GUIDE_GUIDANCE`. The contract and
 * section cap are always included, so a garbage or empty guidance can never
 * strip the emit/finalize contract that generation depends on.
 */
export function buildSystemPrompt(
  names: ToolNames,
  guidance?: string | null,
  sectionCap = SECTION_CAP
): string {
  const effective = guidance && guidance.trim() ? guidance.trim() : DEFAULT_GUIDE_GUIDANCE
  return `${buildContract(names, sectionCap)}\n\n${effective}`
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
