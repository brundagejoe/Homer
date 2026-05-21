import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FileWithPatch } from './ipc'

export interface DiffSourceSpec {
  type: 'working-tree-vs-head'
}

export interface LineComment {
  id: string
  path: string
  lineNumber: number
  side: 'old' | 'new'
  body: string
}

export interface DiffSnapshot {
  files: FileWithPatch[]
}

export interface PendingReview {
  repoPath: string
  sourceSpec: DiffSourceSpec
  snapshot: DiffSnapshot
  lineComments: LineComment[]
  summary: string
  createdAt: number
  updatedAt: number
}

export interface ReviewKey {
  repoPath: string
  sourceSpec: DiffSourceSpec
}

function keyFor(key: ReviewKey): string {
  return `${key.repoPath}::${key.sourceSpec.type}`
}

export class PendingReviewStore {
  private map: Map<string, PendingReview>

  constructor(private readonly filePath: string) {
    this.map = new Map()
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf8')
      const arr: PendingReview[] = JSON.parse(raw)
      for (const r of arr) this.map.set(keyFor(r), r)
    }
  }

  get(key: ReviewKey): PendingReview | null {
    return this.map.get(keyFor(key)) ?? null
  }

  upsert(review: PendingReview): void {
    this.map.set(keyFor(review), review)
    this.flush()
  }

  delete(key: ReviewKey): void {
    this.map.delete(keyFor(key))
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
