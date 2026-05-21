import type { PendingReview, LineComment, DiffSnapshot } from './pending-review-store'

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
  const lines: string[] = [`### \`${comment.path}:${comment.lineNumber}\``, '']
  const file = snapshot.files.find(f => f.path === comment.path)
  if (file?.patch) {
    const context = findLineContent(file.patch, comment.side, comment.lineNumber)
    if (context !== null) {
      const sigil = comment.side === 'old' ? '-' : '+'
      lines.push('```', `${sigil} ${context}`, '```', '')
    }
  }
  lines.push(comment.body.trim(), '')
  return lines.join('\n')
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
  const pathOrder = Array.from(byPath.keys())

  for (const path of pathOrder) {
    sections.push(`## ${path}`, '')
    for (const comment of byPath.get(path)!) {
      sections.push(renderComment(comment, review.snapshot))
    }
  }

  return sections.join('\n')
}
