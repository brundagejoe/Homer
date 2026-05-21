import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FileWithPatch } from './ipc'

export type ReviewTarget =
  | { kind: 'local'; repoPath: string; source: { type: 'working-tree-vs-head' } }
  | { kind: 'pr'; owner: string; repo: string; number: number }

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export interface LineComment {
  id: string
  path: string
  lineNumber: number
  side: 'old' | 'new'
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
  summary: string
  /** PR-only: the submit mode. Undefined for local/agent destinations. */
  event?: ReviewEvent
  createdAt: number
  updatedAt: number
}

export function keyForTarget(target: ReviewTarget): string {
  if (target.kind === 'local') return `local::${target.repoPath}::${target.source.type}`
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
