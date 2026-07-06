import { describe, test, expect } from 'bun:test'
import type { DiffSnapshot, ReviewTarget } from '../../preload'
import {
  buildComment,
  initialDraftState,
  reviewDraftReducer,
  type DraftState
} from './review-draft'

const target: ReviewTarget = { owner: 'o', repo: 'r', number: 7 }

const snapshot: DiffSnapshot = {
  files: [{ path: 'a.ts', status: 'modified', isBinary: false, patch: '@@' }]
}

const anchor = { lineNumber: 10, side: 'new' as const }

function start(): DraftState {
  return initialDraftState(target)
}

describe('reviewDraftReducer', () => {
  test('hydrate seeds pending without persisting', () => {
    const review = { ...reviewDraftReducer(start(), { type: 'startReview', snapshot, now: 1 })[0].pending! }
    const [state, effect] = reviewDraftReducer(start(), { type: 'hydrate', pending: review })
    expect(state.pending).toBe(review)
    expect(effect.kind).toBe('none')
  })

  test('startReview creates an empty pending review and persists it', () => {
    const [state, effect] = reviewDraftReducer(start(), { type: 'startReview', snapshot, now: 5 })
    expect(state.pending).toMatchObject({ lineComments: [], summary: '', createdAt: 5, updatedAt: 5 })
    expect(state.pending!.snapshot).toBe(snapshot)
    expect(effect).toEqual({ kind: 'persist', review: state.pending! })
  })

  test('startReview omits event unless provided, includes it when given', () => {
    const without = reviewDraftReducer(start(), { type: 'startReview', snapshot, now: 1 })[0]
    expect(without.pending!.event).toBeUndefined()
    const withEvent = reviewDraftReducer(start(), {
      type: 'startReview',
      snapshot,
      event: 'COMMENT',
      now: 1
    })[0]
    expect(withEvent.pending!.event).toBe('COMMENT')
  })

  test('addDraft buffers a new comment without persisting', () => {
    const comment = buildComment('c1', { path: 'a.ts', anchor })
    const [state, effect] = reviewDraftReducer(start(), { type: 'addDraft', comment })
    expect(state.editing.get('c1')).toEqual({ comment, isNew: true })
    expect(effect.kind).toBe('none')
    expect(state.pending).toBeNull()
  })

  test('committing a fresh draft with no pending promotes it into a new Pending Review', () => {
    const comment = buildComment('c1', { path: 'a.ts', anchor })
    let state = reviewDraftReducer(start(), { type: 'addDraft', comment })[0]
    state = reviewDraftReducer(state, { type: 'changeBody', id: 'c1', body: 'hi' })[0]
    const [next, effect] = reviewDraftReducer(state, { type: 'commitComment', id: 'c1', snapshot, now: 9 })
    expect(next.pending!.lineComments).toEqual([{ ...comment, body: 'hi' }])
    expect(next.editing.has('c1')).toBe(false)
    expect(effect).toEqual({ kind: 'persist', review: next.pending! })
  })

  test('committing a fresh draft with an existing pending appends to it', () => {
    let state = reviewDraftReducer(start(), { type: 'startReview', snapshot, now: 1 })[0]
    const comment = buildComment('c1', { path: 'a.ts', anchor })
    state = reviewDraftReducer(state, { type: 'addDraft', comment })[0]
    const [next] = reviewDraftReducer(state, { type: 'commitComment', id: 'c1', snapshot, now: 2 })
    expect(next.pending!.lineComments).toEqual([comment])
    expect(next.pending!.updatedAt).toBe(2)
  })

  test('editComment loads a committed comment into the buffer; commit replaces it', () => {
    let state = reviewDraftReducer(start(), { type: 'startReview', snapshot, now: 1 })[0]
    const comment = buildComment('c1', { path: 'a.ts', anchor })
    state = reviewDraftReducer(state, { type: 'addDraft', comment })[0]
    state = reviewDraftReducer(state, { type: 'changeBody', id: 'c1', body: 'first' })[0]
    state = reviewDraftReducer(state, { type: 'commitComment', id: 'c1', snapshot, now: 2 })[0]

    state = reviewDraftReducer(state, { type: 'editComment', id: 'c1' })[0]
    expect(state.editing.get('c1')).toMatchObject({ isNew: false })
    state = reviewDraftReducer(state, { type: 'changeBody', id: 'c1', body: 'edited' })[0]
    const [next] = reviewDraftReducer(state, { type: 'commitComment', id: 'c1', snapshot, now: 3 })
    expect(next.pending!.lineComments).toEqual([{ ...comment, body: 'edited' }])
    expect(next.editing.has('c1')).toBe(false)
  })

  test('editComment is a no-op when the comment is not in the pending review', () => {
    const [state, effect] = reviewDraftReducer(start(), { type: 'editComment', id: 'missing' })
    expect(state.editing.size).toBe(0)
    expect(effect.kind).toBe('none')
  })

  test('cancelComment drops the buffer entry without persisting', () => {
    const comment = buildComment('c1', { path: 'a.ts', anchor })
    let state = reviewDraftReducer(start(), { type: 'addDraft', comment })[0]
    const [next, effect] = reviewDraftReducer(state, { type: 'cancelComment', id: 'c1' })
    expect(next.editing.has('c1')).toBe(false)
    expect(effect.kind).toBe('none')
  })

  test('removeComment deletes from pending and clears any buffered edit', () => {
    let state = reviewDraftReducer(start(), { type: 'startReview', snapshot, now: 1 })[0]
    const comment = buildComment('c1', { path: 'a.ts', anchor })
    state = reviewDraftReducer(state, { type: 'addDraft', comment })[0]
    state = reviewDraftReducer(state, { type: 'commitComment', id: 'c1', snapshot, now: 2 })[0]
    state = reviewDraftReducer(state, { type: 'editComment', id: 'c1' })[0]
    const [next, effect] = reviewDraftReducer(state, { type: 'removeComment', id: 'c1', now: 3 })
    expect(next.pending!.lineComments).toEqual([])
    expect(next.editing.has('c1')).toBe(false)
    expect(effect.kind).toBe('persist')
  })

  test('setSummary / setEvent / refreshSnapshot are no-ops without a pending review', () => {
    expect(reviewDraftReducer(start(), { type: 'setSummary', summary: 'x', now: 1 })[1].kind).toBe('none')
    expect(reviewDraftReducer(start(), { type: 'setEvent', event: 'APPROVE', now: 1 })[1].kind).toBe('none')
    expect(reviewDraftReducer(start(), { type: 'refreshSnapshot', snapshot, now: 1 })[1].kind).toBe('none')
  })

  test('setSummary updates and persists when a review exists', () => {
    let state = reviewDraftReducer(start(), { type: 'startReview', snapshot, now: 1 })[0]
    const [next, effect] = reviewDraftReducer(state, { type: 'setSummary', summary: 'looks good', now: 4 })
    expect(next.pending!.summary).toBe('looks good')
    expect(next.pending!.updatedAt).toBe(4)
    expect(effect.kind).toBe('persist')
  })

  test('refreshSnapshot swaps the frozen snapshot, keeping comments', () => {
    let state = reviewDraftReducer(start(), { type: 'startReview', snapshot, now: 1 })[0]
    const fresh: DiffSnapshot = { files: [] }
    const [next] = reviewDraftReducer(state, { type: 'refreshSnapshot', snapshot: fresh, now: 5 })
    expect(next.pending!.snapshot).toBe(fresh)
  })

  test('discard clears state and emits a delete effect', () => {
    let state = reviewDraftReducer(start(), { type: 'startReview', snapshot, now: 1 })[0]
    const [next, effect] = reviewDraftReducer(state, { type: 'discard' })
    expect(next.pending).toBeNull()
    expect(effect).toEqual({ kind: 'delete', target })
  })

  test('submitted clears state without a persistence effect (server already cleared)', () => {
    let state = reviewDraftReducer(start(), { type: 'startReview', snapshot, now: 1 })[0]
    const [next, effect] = reviewDraftReducer(state, { type: 'submitted' })
    expect(next.pending).toBeNull()
    expect(effect.kind).toBe('none')
  })
})

describe('buildComment', () => {
  test('single-line anchor omits start fields', () => {
    const c = buildComment('id', { path: 'a.ts', anchor: { lineNumber: 3, side: 'new' } })
    expect(c).toEqual({ id: 'id', path: 'a.ts', lineNumber: 3, side: 'new', body: '' })
  })

  test('multi-line anchor carries start line and side', () => {
    const c = buildComment('id', {
      path: 'a.ts',
      anchor: { lineNumber: 8, side: 'new', startLineNumber: 4, startSide: 'old' }
    })
    expect(c).toMatchObject({ startLineNumber: 4, startSide: 'old', lineNumber: 8, side: 'new' })
  })

  test('reply carries inReplyToId', () => {
    const c = buildComment('id', { path: 'a.ts', anchor: { lineNumber: 1, side: 'new' }, inReplyToId: 42 })
    expect(c.inReplyToId).toBe(42)
  })
})
