import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FileWithPatch } from './ipc'

/**
 * The one and only Destination is the GitHub PR, so a Pending Review is
 * keyed to (repo, PR): owner/repo plus the PR number.
 */
export type ReviewTarget = { owner: string; repo: string; number: number }

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export interface LineComment {
  id: string
  path: string
  /** Last line of the comment's anchor range (or the single line). */
  lineNumber: number
  /** Side for the last line. */
  side: 'old' | 'new'
  /** First line of a multi-line range. Omit for single-line comments. */
  startLineNumber?: number
  /** Side for the first line of a multi-line range. */
  startSide?: 'old' | 'new'
  body: string
  /** GitHub review comment id this is replying to (PR reviews only). */
  inReplyToId?: number
}

export interface DiffSnapshot {
  files: FileWithPatch[]
}

export interface PendingReview {
  target: ReviewTarget
  snapshot: DiffSnapshot
  lineComments: LineComment[]
  /**
   * Line Comments that no longer anchored cleanly after a Refresh re-snapshot
   * (ADR 0001). Kept — never silently dropped — so the human-authored text is
   * preserved and surfaced with a warning until the reviewer resolves each one.
   */
  orphanedComments?: LineComment[]
  summary: string
  /** The submit mode (approve / request-changes / comment). */
  event?: ReviewEvent
  createdAt: number
  updatedAt: number
}

export function keyForTarget(target: ReviewTarget): string {
  return `pr::${target.owner}/${target.repo}#${target.number}`
}

export class PendingReviewStore {
  private map: Map<string, PendingReview>

  constructor(private readonly filePath: string) {
    this.map = new Map()
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf8')
      const arr: PendingReview[] = JSON.parse(raw)
      for (const r of arr) this.map.set(keyForTarget(r.target), r)
    }
  }

  get(target: ReviewTarget): PendingReview | null {
    return this.map.get(keyForTarget(target)) ?? null
  }

  upsert(review: PendingReview): void {
    this.map.set(keyForTarget(review.target), review)
    this.flush()
  }

  delete(target: ReviewTarget): void {
    this.map.delete(keyForTarget(target))
    this.flush()
  }

  list(): PendingReview[] {
    return [...this.map.values()]
  }

  private flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify([...this.map.values()], null, 2))
  }
}
