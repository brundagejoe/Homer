import { useEffect, useRef, type ReactNode } from 'react'
import type { DiffLineAnnotation } from '@pierre/diffs'
import { Markdown } from './Markdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Tooltip } from '@/components/ui/tooltip'
import type { AnnotationMeta } from './diff-annotations'
import type { AnchorSpec, Editing } from './review-draft'
import type { UseReviewDraft } from './useReviewDraft'
import type { InlineComment, LineComment, PendingReview, ReviewEvent } from '../../preload'

/**
 * The shared review-comment UI kit: the presentation + dispatch layer that
 * sits on top of the (already shared) Pending Review state machine
 * (`useReviewDraft` / `review-draft` / `diff-annotations` / `ReviewSurface`).
 *
 * Both authoring surfaces reuse this — the Diff tab today and the Guide tab
 * (slice #29) next — so the annotation dispatch, the three comment cards,
 * and the batched-Review panel live here rather than being copy-pasted into
 * each view. Nothing here is Diff-specific: callers hand it a
 * `UseReviewDraft` and a panel-opening `startDraft`, and wire the output
 * into `ReviewSurface`'s `renderAnnotation` / `reviewPanel` props.
 */

/** A `startDraft` that also opens the review panel (i.e. `ReviewSurfaceShell.startDraft`). */
type StartDraft = (spec: { path: string; anchor: AnchorSpec; inReplyToId?: number }) => void

/** "12-18" if multi-line, "12" otherwise. */
export function formatLineRange(start: number | undefined, end: number): string {
  return start != null && start !== end ? `${start}-${end}` : `${end}`
}

/** New (not-yet-committed) drafts need an annotation slot so their editor
 *  renders at the right line. */
export function draftComments(editing: ReadonlyMap<string, Editing>): LineComment[] {
  return [...editing.values()].filter(e => e.isNew).map(e => e.comment)
}

/**
 * Build the `renderAnnotation` dispatcher for `ReviewSurface`: it maps each
 * annotation (existing GitHub thread / in-flight draft editor / committed
 * pending card) to its component, driven entirely by the supplied draft.
 * `startDraft` is the panel-opening variant so a reply opens the panel too.
 */
export function makeReviewAnnotationRenderer({
  draft,
  startDraft
}: {
  draft: UseReviewDraft
  startDraft: StartDraft
}): (ann: DiffLineAnnotation<AnnotationMeta>) => ReactNode {
  const { pending, editing } = draft
  return ann => {
    const meta = ann.metadata!
    if (meta.kind === 'existing') {
      const replyToId = meta.comment.id
      const hasReply =
        (pending?.lineComments ?? []).some(c => c.inReplyToId === replyToId) ||
        [...editing.values()].some(e => e.isNew && e.comment.inReplyToId === replyToId)
      return (
        <ExistingThreadAnnotation
          comment={meta.comment}
          hasReply={hasReply}
          onReply={() =>
            startDraft({
              path: meta.comment.path,
              anchor: {
                lineNumber: meta.comment.lineNumber,
                side: meta.comment.side === 'LEFT' ? 'old' : 'new'
              },
              inReplyToId: meta.comment.id
            })
          }
        />
      )
    }
    const id = meta.comment.id
    const edit = editing.get(id)
    if (edit) {
      return (
        <PendingCommentEditor
          comment={edit.comment}
          onChange={body => draft.updateBody(id, body)}
          onSubmit={() => draft.commit(id)}
          onCancel={() => draft.cancel(id)}
        />
      )
    }
    const committed = pending?.lineComments.find(c => c.id === id)
    if (!committed) return null
    return (
      <PendingCommentCard
        comment={committed}
        onEdit={() => draft.startEdit(id)}
        onDelete={() => draft.remove(id)}
      />
    )
  }
}

/**
 * Read-only render of an existing GitHub thread. A Reply button appears
 * when the viewer has no draft reply to this thread yet.
 */
export function ExistingThreadAnnotation({
  comment,
  hasReply,
  onReply
}: {
  comment: InlineComment
  hasReply: boolean
  onReply?: () => void
}) {
  const range = formatLineRange(comment.startLine, comment.lineNumber)
  return (
    <div className="review-annotation rounded-md px-2.5 py-1.5 mx-2 my-1 text-[12.5px]">
      <div className="text-[11px] text-subtle">
        {comment.author} · line {range} · {new Date(comment.createdAt).toLocaleString()}
      </div>
      <Markdown compact>{comment.body}</Markdown>
      {onReply && !hasReply && (
        <Button size="sm" onClick={onReply} className="self-start mt-1">
          Reply
        </Button>
      )}
    </div>
  )
}

/**
 * Editing state for an inline draft comment. The body lives in React
 * state (separate from the pending review on disk) so typing doesn't
 * fight Pierre's snapshot cache, and cancelling a brand-new draft
 * abandons it cleanly without ever touching disk.
 */
export function PendingCommentEditor({
  comment,
  onChange,
  onSubmit,
  onCancel
}: {
  comment: LineComment
  onChange: (body: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isReply = comment.inReplyToId != null
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])
  // Click-outside-to-cancel.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = containerRef.current
      if (!root) return
      const node = e.target as Node | null
      if (node && root.contains(node)) return
      onCancel()
    }
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onCancel])
  const canSubmit = comment.body.trim().length > 0
  const range = formatLineRange(comment.startLineNumber, comment.lineNumber)
  return (
    <div
      ref={containerRef}
      className="border border-hairline-strong rounded-md bg-elevated px-2.5 py-2 mx-2 my-1 flex flex-col gap-2"
    >
      <div className="text-[11px] text-muted">
        {isReply ? 'Your reply' : `Your comment · line ${range}`}
      </div>
      <Textarea
        ref={textareaRef}
        value={comment.body}
        onChange={e => onChange(e.target.value)}
        rows={3}
        placeholder={isReply ? 'Write a reply…' : 'Write a comment…'}
        className="w-full text-[12.5px]"
        onKeyDown={e => {
          // Stop these from bubbling to the window-level review shortcuts.
          // Without stopPropagation, ⌘/Ctrl+Enter here would ALSO fire the
          // global "submit review to GitHub" once a review is pending — an
          // irreversible submit that posts before this comment is committed.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
            e.preventDefault()
            e.stopPropagation()
            onSubmit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={onSubmit} disabled={!canSubmit}>
          Add review comment
        </Button>
      </div>
    </div>
  )
}

/**
 * Collapsed read-only view of a comment already on the pending review.
 * Edit puts it back into editing state; Delete removes it entirely.
 */
export function PendingCommentCard({
  comment,
  onEdit,
  onDelete
}: {
  comment: LineComment
  onEdit: () => void
  onDelete: () => void
}) {
  const isReply = comment.inReplyToId != null
  const range = formatLineRange(comment.startLineNumber, comment.lineNumber)
  return (
    <div className="border border-accent/40 bg-selected/60 rounded-md px-2.5 py-1.5 mx-2 my-1 flex flex-col gap-1 text-[12.5px]">
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>
          {isReply ? 'Your reply · pending review' : `Your comment · line ${range} · pending review`}
        </span>
        <div className="flex gap-1">
          <Tooltip content="Edit">
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit comment">
              ✎
            </Button>
          </Tooltip>
          <Tooltip content="Delete">
            <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete comment">
              ×
            </Button>
          </Tooltip>
        </div>
      </div>
      <Markdown compact>{comment.body}</Markdown>
    </div>
  )
}

/** The batched-Review panel: comment roster, overall summary, submit
 *  event, and the submit / discard actions. GitHub PR is the only
 *  Destination, so there is no destination picker. */
export function ReviewPanel({
  pending,
  submitting,
  onSummary,
  onEvent,
  onSubmit,
  onDiscard
}: {
  pending: PendingReview
  submitting: boolean
  onSummary: (s: string) => void
  onEvent: (e: ReviewEvent) => void
  onSubmit: () => void
  onDiscard: () => void
}) {
  const newCount = pending.lineComments.filter(c => c.inReplyToId == null).length
  const replyCount = pending.lineComments.length - newCount
  return (
    <aside className="h-full w-full bg-sidebar p-3 flex flex-col gap-3 overflow-hidden">
      <h3 className="m-0 text-[14px] font-semibold">Pending review</h3>

      <div className="text-[12px] text-muted">
        {pending.lineComments.length === 0 ? (
          'No comments yet — click the + in the gutter to add one'
        ) : (
          <>
            {newCount} new {newCount === 1 ? 'comment' : 'comments'}
            {replyCount > 0 && ` · ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
          </>
        )}
      </div>

      {pending.lineComments.length > 0 && (
        <div className="overflow-auto flex flex-col gap-1.5 max-h-[40%] shrink-0">
          {pending.lineComments.map(c => (
            <div key={c.id} className="p-1.5 border border-hairline rounded text-[11.5px] bg-elevated">
              <div className="text-subtle text-[10.5px] truncate">
                {c.path}:{formatLineRange(c.startLineNumber, c.lineNumber)}
                {c.inReplyToId != null && ' · reply'}
              </div>
              <div className="line-clamp-2 text-fg">{c.body || '(empty)'}</div>
            </div>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1 flex-1 min-h-0">
        <span className="text-[11px] text-muted">Summary</span>
        <Textarea
          value={pending.summary}
          onChange={e => onSummary(e.target.value)}
          placeholder="Overall feedback…"
          className="w-full text-[12.5px] flex-1 min-h-[80px]"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">Submit as</span>
        <Select value={pending.event ?? 'COMMENT'} onChange={e => onEvent(e.target.value as ReviewEvent)}>
          <option value="COMMENT">Comment</option>
          <option value="APPROVE">Approve</option>
          <option value="REQUEST_CHANGES">Request changes</option>
        </Select>
      </label>

      <div className="flex gap-2">
        <Tooltip content="Submit review to GitHub" shortcut="⌘⏎">
          <Button variant="primary" onClick={onSubmit} disabled={submitting} className="flex-1">
            {submitting ? 'Submitting…' : 'Submit review'}
          </Button>
        </Tooltip>
        <Button onClick={onDiscard}>Discard</Button>
      </div>
    </aside>
  )
}
