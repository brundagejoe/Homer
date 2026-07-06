import { useCallback, useEffect, useMemo, useState } from 'react'
import { splitPatchByFile } from '../../shared/split-patch'
import { useReviewDraft, useReviewSubmit } from './useReviewDraft'
import type { UseReviewDraft } from './useReviewDraft'
import type { DiffSnapshot, InlineComment, PrTarget, ReviewTarget } from '../../preload'

export type DiffFile = { path: string; patch: string }

export type DiffStatus =
  | { type: 'loading' }
  | { type: 'loaded'; files: DiffFile[]; inline: InlineComment[] }
  | { type: 'error'; message: string }

/**
 * The review workspace for one PR: the `base...head` diff plus the single
 * shared Pending Review draft that spans the Guide and Diff tabs.
 *
 * The draft is lifted to this common owner (the Window) so both tabs author
 * into ONE Pending Review — comments made in the Guide and in the Diff
 * accumulate together and submit as one Review (CONTEXT.md; slice #29). Each
 * tab reuses the same instance rather than constructing its own, which would
 * fork the in-memory state even though it hydrates from the same SQLite row.
 *
 * The diff is fetched here (not lazily in the Diff tab) because the frozen
 * Diff Snapshot (ADR 0001) is built from it, and a comment can be authored
 * from the Guide before the Diff tab is ever opened. `buildSnapshot` reads the
 * latest loaded files, so the snapshot a review freezes reflects the diff by
 * the time the reviewer starts commenting.
 */
export interface ReviewWorkspace {
  diff: DiffStatus
  /** Whether the diff has loaded — Guide authoring is gated on it (ADR 0001). */
  diffLoaded: boolean
  /** Existing GitHub review threads (empty until the diff has loaded). */
  inline: InlineComment[]
  draft: UseReviewDraft
  submitting: boolean
  submit: () => Promise<void>
  discard: () => Promise<void>
}

const NO_FILES: DiffFile[] = []
const NO_INLINE: InlineComment[] = []

export function useReviewWorkspace(target: PrTarget): ReviewWorkspace {
  const [diff, setDiff] = useState<DiffStatus>({ type: 'loading' })

  useEffect(() => {
    let cancelled = false
    setDiff({ type: 'loading' })
    Promise.all([
      window.api.githubGetPRDiff(target),
      window.api.githubGetPRInlineComments(target)
    ])
      .then(([rawDiff, inline]) => {
        if (!cancelled) setDiff({ type: 'loaded', files: splitPatchByFile(rawDiff), inline })
      })
      .catch((err: Error) => {
        if (!cancelled) setDiff({ type: 'error', message: err.message ?? String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [target.owner, target.repo, target.number])

  const files = diff.type === 'loaded' ? diff.files : NO_FILES

  const reviewTarget: ReviewTarget = useMemo(
    () => ({ owner: target.owner, repo: target.repo, number: target.number }),
    [target.owner, target.repo, target.number]
  )

  // A freshly-started Review freezes the diff it was drafted against (the
  // Diff Snapshot, ADR 0001). PR patches carry no binary flag.
  const buildSnapshot = useCallback(
    (): DiffSnapshot => ({
      files: files.map(f => ({ ...f, status: 'modified' as const, isBinary: false, oldPath: undefined }))
    }),
    [files]
  )

  const draft = useReviewDraft({ target: reviewTarget, buildSnapshot, defaultEvent: 'COMMENT' })
  const { submitting, submit, discard } = useReviewSubmit(draft)

  return {
    diff,
    diffLoaded: diff.type === 'loaded',
    inline: diff.type === 'loaded' ? diff.inline : NO_INLINE,
    draft,
    submitting,
    submit,
    discard
  }
}
