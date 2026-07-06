import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { confirm } from '@/components/ui/alert-dialog'
import type { DiffSnapshot, LineComment, PendingReview, ReviewEvent, ReviewTarget } from '../../preload'
import { reconcileComments } from '../../shared/comment-reconciliation'
import {
  type AnchorSpec,
  type DraftAction,
  type DraftState,
  type Editing,
  buildComment,
  initialDraftState,
  reviewDraftReducer
} from './review-draft'

export type { AnchorSpec, Editing }

/** The survivor/orphan split a Refresh produced. */
export interface RefreshResult {
  carried: LineComment[]
  orphaned: LineComment[]
}

export interface UseReviewDraft {
  pending: PendingReview | null
  editing: ReadonlyMap<string, Editing>
  startReview: () => void
  startDraft: (spec: { path: string; anchor: AnchorSpec; inReplyToId?: number }) => void
  startEdit: (id: string) => void
  updateBody: (id: string, body: string) => void
  commit: (id: string) => void
  cancel: (id: string) => void
  remove: (id: string) => void
  setSummary: (summary: string) => void
  setEvent: (event: ReviewEvent) => void
  /**
   * Re-snapshot after a Refresh. The single reconciliation site: it splits the
   * Pending Review's Line Comments against the new snapshot (survivors carry,
   * orphans are flagged), applies the split, and returns it for the caller to
   * report. Returns empty arrays when there is no Pending Review to reconcile.
   */
  refresh: (snapshot: DiffSnapshot) => RefreshResult
  /** Acknowledge (discard) one flagged orphan comment. */
  dismissOrphan: (id: string) => void
  discard: () => void
  markSubmitted: () => void
}

/**
 * Owns the Pending Review lifecycle for one PR. Holds the pure draft
 * state (see review-draft.ts), hydrates it from the store, and runs the
 * persistence effect the reducer emits — so every authoring surface (the
 * Diff tab today, the Guide tab in slice #29) shares one drafting machine
 * instead of each carrying a copy.
 *
 * `buildSnapshot` decides what a freshly-started review freezes as its
 * Diff Snapshot (ADR 0001) — the shared workspace normalizes its
 * `base...head` files. `defaultEvent` seeds the review's GitHub submit
 * event. (Gutter-selection clearing is a per-surface concern, handled by
 * `useClearSelectionWhenIdle`, so it is not a draft-machine responsibility.)
 */
export function useReviewDraft(opts: {
  target: ReviewTarget
  buildSnapshot: () => DiffSnapshot
  defaultEvent?: ReviewEvent
}): UseReviewDraft {
  const { target, buildSnapshot, defaultEvent } = opts

  const [state, setState] = useState<DraftState>(() => initialDraftState(target))
  const stateRef = useRef(state)
  stateRef.current = state

  // Keep mutable bits in refs so `dispatch` stays referentially stable.
  const snapshotRef = useRef(buildSnapshot)
  snapshotRef.current = buildSnapshot
  const eventRef = useRef(defaultEvent)
  eventRef.current = defaultEvent

  const dispatch = useCallback((action: DraftAction) => {
    const [next, effect] = reviewDraftReducer(stateRef.current, action)
    stateRef.current = next
    setState(next)
    if (effect.kind === 'persist') window.api.reviewUpsert(effect.review)
    else if (effect.kind === 'delete') window.api.reviewDelete(effect.target)
  }, [])

  // Reset and re-hydrate whenever the target changes. The caller passes
  // a memoized target so this fires once per PR.
  useEffect(() => {
    const fresh = initialDraftState(target)
    stateRef.current = fresh
    setState(fresh)
    window.api.reviewGet(target).then(pending => dispatch({ type: 'hydrate', pending }))
  }, [target, dispatch])

  return {
    pending: state.pending,
    editing: state.editing,
    startReview: () =>
      dispatch({
        type: 'startReview',
        snapshot: snapshotRef.current(),
        event: eventRef.current,
        now: Date.now()
      }),
    startDraft: spec => dispatch({ type: 'addDraft', comment: buildComment(crypto.randomUUID(), spec) }),
    startEdit: id => dispatch({ type: 'editComment', id }),
    updateBody: (id, body) => dispatch({ type: 'changeBody', id, body }),
    commit: id =>
      dispatch({
        type: 'commitComment',
        id,
        snapshot: snapshotRef.current(),
        event: eventRef.current,
        now: Date.now()
      }),
    cancel: id => dispatch({ type: 'cancelComment', id }),
    remove: id => dispatch({ type: 'removeComment', id, now: Date.now() }),
    setSummary: summary => dispatch({ type: 'setSummary', summary, now: Date.now() }),
    setEvent: event => dispatch({ type: 'setEvent', event, now: Date.now() }),
    refresh: snapshot => {
      const pending = stateRef.current.pending
      const result: RefreshResult = pending
        ? reconcileComments({
            comments: pending.lineComments,
            oldSnapshot: pending.snapshot,
            newSnapshot: snapshot
          })
        : { carried: [], orphaned: [] }
      dispatch({
        type: 'refreshSnapshot',
        snapshot,
        carried: result.carried,
        orphaned: result.orphaned,
        now: Date.now()
      })
      return result
    },
    dismissOrphan: id => dispatch({ type: 'dismissOrphan', id, now: Date.now() }),
    discard: () => dispatch({ type: 'discard' }),
    markSubmitted: () => dispatch({ type: 'submitted' })
  }
}

export interface UseReviewSubmit {
  submitting: boolean
  /** Post the Pending Review to the GitHub PR, then clear local state. */
  submit: () => Promise<void>
  /** Confirm, then discard the Pending Review. */
  discard: () => Promise<void>
}

/**
 * Submit / discard orchestration for a Pending Review. This is a property
 * of the Review itself (post to GitHub → markSubmitted → toast; or confirm
 * → discard), not of any one authoring surface, so every view that hosts a
 * draft — the Diff tab today, the Guide tab (slice #29) next — drives it
 * the same way instead of re-implementing the toast/retry/confirm dance.
 */
export function useReviewSubmit(draft: UseReviewDraft): UseReviewSubmit {
  const { pending } = draft
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(async () => {
    if (!pending) return
    setSubmitting(true)
    try {
      const { url } = await window.api.reviewSubmitToGithub(pending)
      draft.markSubmitted()
      toast.success('Review submitted', {
        actionLabel: 'Open on GitHub',
        onAction: () => window.open(url, '_blank', 'noreferrer')
      })
    } catch (err) {
      toast.error('Submit failed', {
        description: (err as Error).message,
        actionLabel: 'Retry',
        onAction: submit
      })
    } finally {
      setSubmitting(false)
    }
  }, [pending, draft])

  const discard = useCallback(async () => {
    if (!pending) return
    const ok = await confirm({
      title: 'Discard pending review?',
      description: 'All drafted comments and the summary will be lost.',
      confirmLabel: 'Discard',
      destructive: true
    })
    if (ok) draft.discard()
  }, [pending, draft])

  return { submitting, submit, discard }
}
