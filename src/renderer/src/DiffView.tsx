import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CodeViewHandle } from '@pierre/diffs/react'
import { processFile } from '@pierre/diffs'
import { useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import { findUnnarratedHunks, type DiffHunk } from '../../shared/coverage-mapper'
import { useKeyboardShortcut } from './useKeyboardShortcut'
import { ReviewSurface, useReviewSurfaceShell, useClearSelectionWhenIdle } from './ReviewSurface'
import { buildAnnotationMap, type AnnotationMeta, type UnnarratedAnchor } from './diff-annotations'
import { draftComments, makeReviewAnnotationRenderer, ReviewPanel } from './review-comments'
import { buildHunkTargets, clampStep, firstHunkIndexForPath } from './diff-navigation'
import type { DiffFile, ReviewWorkspace } from './useReviewWorkspace'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { CoverageMap } from '../../shared/guide-schema'
import type { InlineComment, PendingReview } from '../../preload'

/**
 * The Diff View: full GitHub-style review of the PR's `base...head` diff
 * (Pierre diffs + file tree). Independent of the Agent/Guide — the diff and
 * the review draft are supplied by the shared workspace, so it works offline
 * or on a generation failure.
 *
 * Authoring is ON here: draft anchored Line Comments from the gutter "+",
 * reply to existing threads, write an overall summary, and submit one
 * batched Review to the GitHub PR as approve / request-changes / comment.
 * Comments accumulate into a durable Pending Review (SQLite) — the SAME one
 * the Guide tab authors into (slice #29) — via the shared draft. The comment
 * presentation, annotation dispatch, and review panel come from the shared
 * `review-comments` kit; this view is the diff-specific wiring (file tree,
 * hunk/file keyboard nav) plus the required Diff-pass finalize gate.
 */
export function DiffView({
  workspace,
  coverage
}: {
  workspace: ReviewWorkspace
  coverage?: CoverageMap
}) {
  const { diff } = workspace
  if (diff.type === 'loading') {
    return <CenteredNote>Loading diff…</CenteredNote>
  }
  if (diff.type === 'error') {
    return <CenteredNote tone="danger">Failed to load diff: {diff.message}</CenteredNote>
  }
  if (diff.files.length === 0) {
    return <CenteredNote>This pull request has no file changes.</CenteredNote>
  }
  return <DiffLoaded workspace={workspace} files={diff.files} inline={diff.inline} coverage={coverage} />
}

function DiffLoaded({
  workspace,
  files,
  inline,
  coverage
}: {
  workspace: ReviewWorkspace
  files: DiffFile[]
  inline: InlineComment[]
  coverage?: CoverageMap
}) {
  const codeViewRef = useRef<CodeViewHandle<AnnotationMeta>>(null)

  const { draft, submitting, submit, discard } = workspace
  const { pending, editing: editingComments } = draft

  // Clear the gutter drag-selection once the inline editor closes (commit or
  // cancel) — the shared behaviour the Guide's diff panels use too.
  useClearSelectionWhenIdle(codeViewRef, editingComments.size)

  // The Review cannot be finalized until the reviewer completes the Diff
  // pass — the required completeness leg (advancing past the last Guide
  // Section does not finalize). We gate submit on an explicit, honest
  // acknowledgement that the diff (with its un-narrated flags) was reviewed.
  const [diffPassDone, setDiffPassDone] = useState(false)
  const gatedSubmit = useCallback(() => {
    if (!diffPassDone) {
      toast.error('Complete the Diff pass first', {
        description: 'Confirm you have reviewed the diff before submitting.'
      })
      return
    }
    submit()
  }, [diffPassDone, submit])

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

  // Reconcile the Guide's Coverage Map against the real diff hunks: every
  // changed hunk the Guide didn't narrate is flagged (CoverageMapper). No
  // coverage yet (Guide unfinalized or failed) → flag all, so nothing hides.
  const unnarrated = useMemo(() => unnarratedAnchors(files, coverage ?? null), [files, coverage])

  // Existing GitHub threads render read-only; pending comments and
  // in-flight drafts render as their own annotations at the right line;
  // un-narrated flags mark the completeness backstop.
  const annotationsByPath = useMemo(
    () =>
      buildAnnotationMap({
        existing: inline,
        pending: pending?.lineComments,
        drafts: draftComments(editingComments),
        unnarrated
      }),
    [inline, pending, editingComments, unnarrated]
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
    pending ? { key: 'Enter', meta: true, allowInForm: true, handler: gatedSubmit } : null
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
              diffPassDone={diffPassDone}
              onDiffPassChange={setDiffPassDone}
              unnarratedCount={unnarrated.length}
              onSummary={draft.setSummary}
              onEvent={draft.setEvent}
              onSubmit={gatedSubmit}
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

/** A diff hunk enriched with where its un-narrated flag should anchor. */
type CoverageHunk = DiffHunk & UnnarratedAnchor

/**
 * Parse each file's patch into hunks and return the anchors for those the
 * Guide did not narrate. A hunk's changed-line span (new side, or old side
 * for a pure deletion) is what CoverageMapper reconciles against the
 * Coverage Map; the flag anchors on that same first changed line.
 */
function unnarratedAnchors(files: DiffFile[], coverage: CoverageMap | null): UnnarratedAnchor[] {
  const hunks: CoverageHunk[] = []
  for (const f of files) {
    const fileDiff = processFile(f.patch)
    if (!fileDiff) continue
    for (const h of fileDiff.hunks) {
      const hasAdds = h.additionLines > 0
      const start = hasAdds ? h.additionStart : h.deletionStart
      const count = hasAdds ? h.additionLines : h.deletionLines
      hunks.push({
        path: f.path,
        side: hasAdds ? 'additions' : 'deletions',
        lineNumber: start,
        lineRange: { start, end: start + Math.max(count, 1) - 1 }
      })
    }
  }
  return findUnnarratedHunks(hunks, coverage)
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
