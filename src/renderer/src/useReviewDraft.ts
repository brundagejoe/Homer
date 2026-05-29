import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiffSnapshot, PendingReview, ReviewEvent, ReviewTarget } from '../../preload'
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
  refresh: (snapshot: DiffSnapshot) => void
  discard: () => void
  markSubmitted: () => void
}

/**
 * Owns the Pending Review lifecycle for one Diff Source. Holds the pure
 * draft state (see review-draft.ts), hydrates it from the store, and
 * runs the persistence effect the reducer emits — so the two review
 * views share one drafting machine instead of each carrying a copy.
 *
 * `buildSnapshot` decides what a freshly-started review freezes (the PR
 * view normalizes its files; Local Mode snapshots the live working
 * tree). `defaultEvent` seeds the review's GitHub event when the
 * destination supports one. `onAfterCommit` lets the view clear its
 * gutter selection once a comment is committed or cancelled.
 */
export function useReviewDraft(opts: {
  target: ReviewTarget
  buildSnapshot: () => DiffSnapshot
  defaultEvent?: ReviewEvent
  onAfterCommit?: () => void
}): UseReviewDraft {
  const { target, buildSnapshot, defaultEvent, onAfterCommit } = opts

  const [state, setState] = useState<DraftState>(() => initialDraftState(target))
  const stateRef = useRef(state)
  stateRef.current = state

  // Keep mutable bits in refs so `dispatch` stays referentially stable.
  const snapshotRef = useRef(buildSnapshot)
  snapshotRef.current = buildSnapshot
  const eventRef = useRef(defaultEvent)
  eventRef.current = defaultEvent
  const afterCommitRef = useRef(onAfterCommit)
  afterCommitRef.current = onAfterCommit

  const dispatch = useCallback((action: DraftAction) => {
    const [next, effect] = reviewDraftReducer(stateRef.current, action)
    stateRef.current = next
    setState(next)
    if (effect.kind === 'persist') window.api.reviewUpsert(effect.review)
    else if (effect.kind === 'delete') window.api.reviewDelete(effect.target)
  }, [])

  // Reset and re-hydrate whenever the target changes. The caller passes
  // a memoized target so this fires once per Diff Source.
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
    commit: id => {
      dispatch({
        type: 'commitComment',
        id,
        snapshot: snapshotRef.current(),
        event: eventRef.current,
        now: Date.now()
      })
      afterCommitRef.current?.()
    },
    cancel: id => {
      dispatch({ type: 'cancelComment', id })
      afterCommitRef.current?.()
    },
    remove: id => dispatch({ type: 'removeComment', id, now: Date.now() }),
    setSummary: summary => dispatch({ type: 'setSummary', summary, now: Date.now() }),
    setEvent: event => dispatch({ type: 'setEvent', event, now: Date.now() }),
    refresh: snapshot => dispatch({ type: 'refreshSnapshot', snapshot, now: Date.now() }),
    discard: () => dispatch({ type: 'discard' }),
    markSubmitted: () => dispatch({ type: 'submitted' })
  }
}
