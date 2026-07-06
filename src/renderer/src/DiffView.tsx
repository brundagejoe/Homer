import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CodeViewHandle } from '@pierre/diffs/react'
import { useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import { splitPatchByFile } from '../../shared/split-patch'
import { useKeyboardShortcut } from './useKeyboardShortcut'
import { ReviewSurface, useReviewSurfaceShell } from './ReviewSurface'
import { useReviewDraft, useReviewSubmit } from './useReviewDraft'
import { buildAnnotationMap, type AnnotationMeta } from './diff-annotations'
import { draftComments, makeReviewAnnotationRenderer, ReviewPanel } from './review-comments'
import { buildHunkTargets, clampStep, firstHunkIndexForPath } from './diff-navigation'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { DiffSnapshot, InlineComment, PendingReview, PrTarget, ReviewTarget } from '../../preload'

type DiffFile = { path: string; patch: string }

type Status =
  | { type: 'loading' }
  | { type: 'loaded'; files: DiffFile[]; inline: InlineComment[] }
  | { type: 'error'; message: string }

/**
 * The Diff View: full GitHub-style review of the PR's `base...head` diff
 * (Pierre diffs + file tree). Independent of the Agent/Guide — it fetches
 * the diff itself and works offline or on a generation failure.
 *
 * Authoring is ON here: draft anchored Line Comments from the gutter "+",
 * reply to existing threads, write an overall summary, and submit one
 * batched Review to the GitHub PR as approve / request-changes / comment.
 * Comments accumulate into a durable Pending Review (SQLite) that survives
 * app restart. The comment presentation, annotation dispatch, and review
 * panel come from the shared `review-comments` kit; this view is the diff-
 * specific wiring (fetch, file tree, hunk/file keyboard nav).
 */
export function DiffView({ target }: { target: PrTarget }) {
  const [status, setStatus] = useState<Status>({ type: 'loading' })

  useEffect(() => {
    let cancelled = false
    setStatus({ type: 'loading' })
    Promise.all([window.api.githubGetPRDiff(target), window.api.githubGetPRInlineComments(target)])
      .then(([rawDiff, inline]) => {
        if (!cancelled) setStatus({ type: 'loaded', files: splitPatchByFile(rawDiff), inline })
      })
      .catch((err: Error) => {
        if (!cancelled) setStatus({ type: 'error', message: err.message ?? String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [target.owner, target.repo, target.number])

  if (status.type === 'loading') {
    return <CenteredNote>Loading diff…</CenteredNote>
  }
  if (status.type === 'error') {
    return <CenteredNote tone="danger">Failed to load diff: {status.message}</CenteredNote>
  }
  if (status.files.length === 0) {
    return <CenteredNote>This pull request has no file changes.</CenteredNote>
  }
  return <DiffLoaded target={target} files={status.files} inline={status.inline} />
}

function DiffLoaded({
  target,
  files,
  inline
}: {
  target: PrTarget
  files: DiffFile[]
  inline: InlineComment[]
}) {
  const codeViewRef = useRef<CodeViewHandle<AnnotationMeta>>(null)

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

  const draft = useReviewDraft({
    target: reviewTarget,
    buildSnapshot,
    defaultEvent: 'COMMENT',
    onAfterCommit: () => codeViewRef.current?.clearSelectedLines()
  })
  const { pending, editing: editingComments } = draft
  const { submitting, submit, discard } = useReviewSubmit(draft)

  const paths = useMemo(() => files.map(f => f.path), [files])
  const sortByDiffOrder = useDiffOrderSort(paths)
  const { model } = useFileTree({
    paths,
    sort: sortByDiffOrder,
    initialExpansion: 'open',
    initialSelectedPaths: paths.length > 0 ? [paths[0]] : []
  })
  const selectedPaths = useFileTreeSelection(model)
  const selectedPath = selectedPaths[0] ?? paths[0]

  // Existing GitHub threads render read-only; pending comments and
  // in-flight drafts render as their own annotations at the right line.
  const annotationsByPath = useMemo(
    () =>
      buildAnnotationMap({
        existing: inline,
        pending: pending?.lineComments,
        drafts: draftComments(editingComments)
      }),
    [inline, pending, editingComments]
  )

  const codeFiles = useMemo(() => files.map(f => ({ ...f, isBinary: false })), [files])
  const shell = useReviewSurfaceShell({
    files: codeFiles,
    annotationsByPath,
    model,
    selectedPath,
    codeViewRef,
    draft
  })
  const { startReview, startDraft, reviewPanelOpen } = shell

  const renderAnnotation = useMemo(
    () => makeReviewAnnotationRenderer({ draft, startDraft }),
    [draft, startDraft]
  )

  const hunkTargets = useMemo(
    () => buildHunkTargets(shell.codeViewItems.map(i => ({ path: i.id, hunks: i.fileDiff.hunks }))),
    [shell.codeViewItems]
  )
  const hunkCursor = useRef(-1)
  useEffect(() => {
    if (selectedPath) hunkCursor.current = firstHunkIndexForPath(hunkTargets, selectedPath)
  }, [selectedPath, hunkTargets])

  const stepFile = useCallback(
    (dir: 1 | -1) => {
      const idx = paths.indexOf(selectedPath)
      const next = clampStep(idx, paths.length, dir)
      if (next >= 0 && next !== idx) model.getItem(paths[next])?.select()
    },
    [paths, selectedPath, model]
  )

  const stepHunk = useCallback(
    (dir: 1 | -1) => {
      const next = clampStep(hunkCursor.current, hunkTargets.length, dir)
      if (next < 0) return
      hunkCursor.current = next
      const t = hunkTargets[next]
      codeViewRef.current?.scrollTo({
        type: 'line',
        id: t.path,
        lineNumber: t.lineNumber,
        side: t.side,
        align: 'center',
        behavior: 'smooth'
      })
    },
    [hunkTargets]
  )

  useKeyboardShortcut({ key: ']', handler: () => stepFile(1) })
  useKeyboardShortcut({ key: '[', handler: () => stepFile(-1) })
  useKeyboardShortcut({ key: 'j', handler: () => stepHunk(1) })
  useKeyboardShortcut({ key: 'k', handler: () => stepHunk(-1) })
  useKeyboardShortcut(pending ? null : { key: 'r', handler: startReview })
  useKeyboardShortcut(
    pending ? { key: 'Enter', meta: true, allowInForm: true, handler: submit } : null
  )

  const showPanel = !!pending && reviewPanelOpen

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ReviewToolbar pending={pending} onStart={startReview} />
      <ReviewSurface
        panesId="diff-panes"
        model={model}
        fileTreeOpen={shell.fileTreeOpen}
        treeSize="18%"
        diffSize={showPanel ? '60%' : '82%'}
        panelSize={showPanel ? '22%' : '0%'}
        codeViewRef={codeViewRef}
        diffSectionRef={shell.diffSectionRef}
        items={shell.codeViewItems}
        renderHeaderPrefix={shell.renderHeaderPrefix}
        enableAuthoring
        onGutterDraft={startDraft}
        emptyState="No diff to display"
        renderAnnotation={renderAnnotation}
        reviewPanel={
          showPanel ? (
            <ReviewPanel
              pending={pending}
              submitting={submitting}
              onSummary={draft.setSummary}
              onEvent={draft.setEvent}
              onSubmit={submit}
              onDiscard={discard}
            />
          ) : null
        }
      />
    </div>
  )
}

/**
 * Slim bar above the diff. Before a Review is started it offers the
 * entry point ("Start review"); once one is pending it reports progress
 * — the summary / event / submit controls live in the review panel.
 */
function ReviewToolbar({
  pending,
  onStart
}: {
  pending: PendingReview | null
  onStart: () => void
}) {
  const count = pending?.lineComments.length ?? 0
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-hairline bg-surface text-[12px]">
      {pending ? (
        <span className="text-muted">
          Review in progress · {count} comment{count === 1 ? '' : 's'}
        </span>
      ) : (
        <>
          <span className="flex-1 text-subtle">
            Draft comments from the + in the gutter, then submit one batched review.
          </span>
          <Tooltip content="Start a pending review" shortcut="r">
            <Button variant="primary" size="sm" onClick={onStart}>
              Start review
            </Button>
          </Tooltip>
        </>
      )}
    </div>
  )
}

/**
 * Produces a Pierre Tree sort comparator that orders entries by their
 * first-appearance index in `paths`. Directories use the minimum index
 * of any descendant file, so folders are visited in the order of their
 * first changed file.
 */
function useDiffOrderSort(paths: readonly string[]) {
  return useMemo(() => {
    const order = new Map<string, number>()
    paths.forEach((p, i) => {
      order.set(p, i)
      const parts = p.split('/')
      for (let d = 1; d < parts.length; d++) {
        const dir = parts.slice(0, d).join('/')
        if (!order.has(dir)) order.set(dir, i)
      }
    })
    return (a: { path: string }, b: { path: string }) => {
      const ai = order.get(a.path) ?? Number.MAX_SAFE_INTEGER
      const bi = order.get(b.path) ?? Number.MAX_SAFE_INTEGER
      return ai - bi
    }
  }, [paths])
}

function CenteredNote({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <section className="flex-1 grid place-items-center px-6">
      <p className={cn('m-0 text-[13px] text-center', tone === 'danger' ? 'text-danger' : 'text-subtle')}>
        {children}
      </p>
    </section>
  )
}
