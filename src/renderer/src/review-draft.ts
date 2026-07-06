import type {
  DiffSnapshot,
  LineComment,
  PendingReview,
  ReviewEvent,
  ReviewTarget
} from '../../preload'

/**
 * The Pending Review drafting machine.
 *
 * This is the single home for the rules every authoring surface shares:
 * what a Pending Review is, how Line Comments are buffered while being
 * edited, when a fresh draft promotes itself into a Pending Review, and
 * what gets persisted when.
 *
 * The reducer is pure and total — every impure input (timestamps, ids,
 * the snapshot to freeze) is supplied by the caller in the action, so
 * the whole lifecycle is exercisable without React or a clock. The
 * matching effect tells the caller what to persist; persistence is the
 * caller's job (see useReviewDraft), keeping this module testable in
 * isolation.
 */

/** Where a Line Comment anchors in the diff (last line + side; first
 *  line/side only for multi-line ranges). */
export interface AnchorSpec {
  lineNumber: number
  side: 'old' | 'new'
  startLineNumber?: number
  startSide?: 'old' | 'new'
}

/**
 * A Line Comment mid-edit. Lives outside the persisted Pending Review:
 * a brand-new draft (`isNew`) the user cancels never touches disk, and
 * edits to an existing comment are buffered until committed.
 */
export interface Editing {
  comment: LineComment
  isNew: boolean
}

export interface DraftState {
  target: ReviewTarget
  pending: PendingReview | null
  editing: Map<string, Editing>
}

/** What the caller must persist after a transition. */
export type DraftEffect =
  | { kind: 'none' }
  | { kind: 'persist'; review: PendingReview }
  | { kind: 'delete'; target: ReviewTarget }

export type DraftAction =
  /** Seed from whatever was persisted for this target (or null). */
  | { type: 'hydrate'; pending: PendingReview | null }
  /** Start an empty Pending Review against the given frozen snapshot. */
  | { type: 'startReview'; snapshot: DiffSnapshot; event?: ReviewEvent; now: number }
  /** Begin a new inline draft (comment pre-built with its id). */
  | { type: 'addDraft'; comment: LineComment }
  /** Move an already-committed comment back into the editing buffer. */
  | { type: 'editComment'; id: string }
  | { type: 'changeBody'; id: string; body: string }
  /** Commit the buffered edit, promoting to a Pending Review if needed. */
  | { type: 'commitComment'; id: string; snapshot: DiffSnapshot; event?: ReviewEvent; now: number }
  | { type: 'cancelComment'; id: string }
  | { type: 'removeComment'; id: string; now: number }
  | { type: 'setSummary'; summary: string; now: number }
  | { type: 'setEvent'; event: ReviewEvent; now: number }
  | { type: 'refreshSnapshot'; snapshot: DiffSnapshot; now: number }
  | { type: 'discard' }
  /** Pending Review left as a submitted Review; clear local state. */
  | { type: 'submitted' }

export function initialDraftState(target: ReviewTarget): DraftState {
  return { target, pending: null, editing: new Map() }
}

/** Build a fresh Line Comment from an anchor. The id is supplied by the
 *  caller so this stays pure. */
export function buildComment(
  id: string,
  spec: { path: string; anchor: AnchorSpec; inReplyToId?: number }
): LineComment {
  return {
    id,
    path: spec.path,
    lineNumber: spec.anchor.lineNumber,
    side: spec.anchor.side,
    ...(spec.anchor.startLineNumber != null ? { startLineNumber: spec.anchor.startLineNumber } : {}),
    ...(spec.anchor.startSide != null ? { startSide: spec.anchor.startSide } : {}),
    body: '',
    ...(spec.inReplyToId != null ? { inReplyToId: spec.inReplyToId } : {})
  }
}

function newReview(
  target: ReviewTarget,
  snapshot: DiffSnapshot,
  lineComments: LineComment[],
  event: ReviewEvent | undefined,
  now: number
): PendingReview {
  return {
    target,
    snapshot,
    lineComments,
    summary: '',
    ...(event ? { event } : {}),
    createdAt: now,
    updatedAt: now
  }
}

const NONE: DraftEffect = { kind: 'none' }

function persist(review: PendingReview): DraftEffect {
  return { kind: 'persist', review }
}

function withoutKey<K, V>(map: Map<K, V>, key: K): Map<K, V> {
  const next = new Map(map)
  next.delete(key)
  return next
}

export function reviewDraftReducer(
  state: DraftState,
  action: DraftAction
): [DraftState, DraftEffect] {
  switch (action.type) {
    case 'hydrate':
      return [{ ...state, pending: action.pending }, NONE]

    case 'startReview': {
      const review = newReview(state.target, action.snapshot, [], action.event, action.now)
      return [{ ...state, pending: review }, persist(review)]
    }

    case 'addDraft':
      return [
        { ...state, editing: new Map(state.editing).set(action.comment.id, { comment: action.comment, isNew: true }) },
        NONE
      ]

    case 'editComment': {
      const existing = state.pending?.lineComments.find(c => c.id === action.id)
      if (!existing) return [state, NONE]
      return [
        { ...state, editing: new Map(state.editing).set(action.id, { comment: { ...existing }, isNew: false }) },
        NONE
      ]
    }

    case 'changeBody': {
      const edit = state.editing.get(action.id)
      if (!edit) return [state, NONE]
      const editing = new Map(state.editing)
      editing.set(action.id, { ...edit, comment: { ...edit.comment, body: action.body } })
      return [{ ...state, editing }, NONE]
    }

    case 'commitComment': {
      const edit = state.editing.get(action.id)
      if (!edit) return [state, NONE]
      if (edit.isNew) {
        const review = state.pending
          ? {
              ...state.pending,
              lineComments: [...state.pending.lineComments, edit.comment],
              updatedAt: action.now
            }
          : newReview(state.target, action.snapshot, [edit.comment], action.event, action.now)
        return [
          { ...state, pending: review, editing: withoutKey(state.editing, action.id) },
          persist(review)
        ]
      }
      // Editing a committed comment requires an existing Pending Review.
      if (!state.pending) return [state, NONE]
      const review = {
        ...state.pending,
        lineComments: state.pending.lineComments.map(c => (c.id === action.id ? edit.comment : c)),
        updatedAt: action.now
      }
      return [
        { ...state, pending: review, editing: withoutKey(state.editing, action.id) },
        persist(review)
      ]
    }

    case 'cancelComment':
      return [{ ...state, editing: withoutKey(state.editing, action.id) }, NONE]

    case 'removeComment': {
      if (!state.pending) return [state, NONE]
      const review = {
        ...state.pending,
        lineComments: state.pending.lineComments.filter(c => c.id !== action.id),
        updatedAt: action.now
      }
      return [
        { ...state, pending: review, editing: withoutKey(state.editing, action.id) },
        persist(review)
      ]
    }

    case 'setSummary': {
      if (!state.pending) return [state, NONE]
      const review = { ...state.pending, summary: action.summary, updatedAt: action.now }
      return [{ ...state, pending: review }, persist(review)]
    }

    case 'setEvent': {
      if (!state.pending) return [state, NONE]
      const review = { ...state.pending, event: action.event, updatedAt: action.now }
      return [{ ...state, pending: review }, persist(review)]
    }

    case 'refreshSnapshot': {
      if (!state.pending) return [state, NONE]
      const review = { ...state.pending, snapshot: action.snapshot, updatedAt: action.now }
      return [{ ...state, pending: review }, persist(review)]
    }

    case 'discard':
      return [{ ...state, pending: null, editing: new Map() }, { kind: 'delete', target: state.target }]

    case 'submitted':
      return [{ ...state, pending: null, editing: new Map() }, NONE]
  }
}
