import type { PendingReview, LineComment, DiffSnapshot, ReviewEvent } from './pending-review-store'

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

function findLineContent(patch: string, side: 'old' | 'new', target: number): string | null {
  const lines = patch.split('\n')
  let oldNum = 0
  let newNum = 0
  for (const line of lines) {
    const hunk = line.match(HUNK_HEADER_RE)
    if (hunk) {
      oldNum = Number(hunk[1])
      newNum = Number(hunk[2])
      continue
    }
    if (line.startsWith(' ')) {
      if (side === 'old' && oldNum === target) return line.slice(1)
      if (side === 'new' && newNum === target) return line.slice(1)
      oldNum++
      newNum++
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      if (side === 'old' && oldNum === target) return line.slice(1)
      oldNum++
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      if (side === 'new' && newNum === target) return line.slice(1)
      newNum++
    }
  }
  return null
}

function renderComment(comment: LineComment, snapshot: DiffSnapshot): string {
  const isMulti =
    comment.startLineNumber != null && comment.startLineNumber !== comment.lineNumber
  const range = isMulti
    ? `${comment.startLineNumber}-${comment.lineNumber}`
    : `${comment.lineNumber}`
  const lines: string[] = [`### \`${comment.path}:${range}\``, '']
  const file = snapshot.files.find(f => f.path === comment.path)
  if (file?.patch) {
    if (isMulti) {
      const block = findLineRange(
        file.patch,
        comment.startSide ?? comment.side,
        comment.side,
        comment.startLineNumber!,
        comment.lineNumber
      )
      if (block.length > 0) {
        lines.push('```', ...block, '```', '')
      }
    } else {
      const context = findLineContent(file.patch, comment.side, comment.lineNumber)
      if (context !== null) {
        const sigil = comment.side === 'old' ? '-' : '+'
        lines.push('```', `${sigil} ${context}`, '```', '')
      }
    }
  }
  lines.push(comment.body.trim(), '')
  return lines.join('\n')
}

/**
 * Walk the patch and collect the lines from (startSide:startLine) through
 * (endSide:endLine), prefixed with their +/- sigils. Best-effort — if a
 * line falls outside the visible patch context the row is skipped.
 */
function findLineRange(
  patch: string,
  startSide: 'old' | 'new',
  endSide: 'old' | 'new',
  startLine: number,
  endLine: number
): string[] {
  const out: string[] = []
  const lines = patch.split('\n')
  let oldNum = 0
  let newNum = 0
  let inRange = false
  const matches = (side: 'old' | 'new', n: number) =>
    side === 'old' ? n === startLine : n === startLine
  for (const line of lines) {
    const hunk = line.match(HUNK_HEADER_RE)
    if (hunk) {
      oldNum = Number(hunk[1])
      newNum = Number(hunk[2])
      continue
    }
    const onLineOld = oldNum
    const onLineNew = newNum
    let sigil = ' '
    let advance: 'both' | 'old' | 'new' = 'both'
    if (line.startsWith('-') && !line.startsWith('---')) {
      sigil = '-'
      advance = 'old'
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      sigil = '+'
      advance = 'new'
    } else if (line.startsWith(' ')) {
      sigil = ' '
    } else {
      continue
    }
    const sideHere: 'old' | 'new' = sigil === '-' ? 'old' : 'new'
    const numHere = sideHere === 'old' ? onLineOld : onLineNew
    if (!inRange && sideHere === startSide && matches(sideHere, numHere)) {
      inRange = true
    }
    if (inRange) {
      out.push(`${sigil} ${line.slice(1)}`)
      if (sideHere === endSide && numHere === endLine) {
        break
      }
    }
    if (advance === 'old' || advance === 'both') oldNum++
    if (advance === 'new' || advance === 'both') newNum++
  }
  return out
}

export function toAgentPrompt(review: PendingReview): string {
  const sections: string[] = ['# Code review feedback', '']
  if (review.summary.trim()) sections.push(review.summary.trim(), '')

  const byPath = new Map<string, LineComment[]>()
  for (const c of review.lineComments) {
    const list = byPath.get(c.path) ?? []
    list.push(c)
    byPath.set(c.path, list)
  }
  for (const list of byPath.values()) {
    list.sort((a, b) => a.lineNumber - b.lineNumber)
  }
  for (const path of byPath.keys()) {
    sections.push(`## ${path}`, '')
    for (const comment of byPath.get(path)!) {
      sections.push(renderComment(comment, review.snapshot))
    }
  }

  return sections.join('\n')
}

export interface GitHubReviewComment {
  path: string
  line?: number
  side?: 'LEFT' | 'RIGHT'
  /** Provide together with start_side for multi-line comments. */
  start_line?: number
  start_side?: 'LEFT' | 'RIGHT'
  body: string
  in_reply_to?: number
}

export interface GitHubReviewPayload {
  body: string
  event: ReviewEvent
  comments: GitHubReviewComment[]
}

export function toGitHubReview(review: PendingReview): GitHubReviewPayload {
  return {
    body: review.summary,
    event: review.event ?? 'COMMENT',
    comments: review.lineComments.map(c => {
      if (c.inReplyToId != null) {
        return { path: c.path, body: c.body, in_reply_to: c.inReplyToId }
      }
      const base: GitHubReviewComment = {
        path: c.path,
        line: c.lineNumber,
        side: c.side === 'old' ? 'LEFT' : 'RIGHT',
        body: c.body
      }
      if (c.startLineNumber != null && c.startLineNumber !== c.lineNumber) {
        base.start_line = c.startLineNumber
        base.start_side = (c.startSide ?? c.side) === 'old' ? 'LEFT' : 'RIGHT'
      }
      return base
    })
  }
}
