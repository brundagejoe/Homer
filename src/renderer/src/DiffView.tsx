import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CodeViewHandle } from '@pierre/diffs/react'
import type { DiffLineAnnotation } from '@pierre/diffs'
import { useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import { splitPatchByFile } from '../../shared/split-patch'
import { useKeyboardShortcut } from './useKeyboardShortcut'
import { ReviewSurface, useReviewSurfaceShell } from './ReviewSurface'
import type { AnnotationMeta } from './diff-annotations'
import { buildHunkTargets, clampStep, firstHunkIndexForPath } from './diff-navigation'
import { cn } from '@/lib/utils'
import type { PrTarget } from '../../preload'

type DiffFile = { path: string; patch: string }

type Status =
  | { type: 'loading' }
  | { type: 'loaded'; files: DiffFile[] }
  | { type: 'error'; message: string }

/**
 * The Diff View: full GitHub-style review of the PR's `base...head` diff
 * (Pierre diffs + file tree). Independent of the Agent/Guide — it fetches
 * the diff itself and works offline or on a generation failure.
 *
 * Read-only in this slice: no Line Comment authoring, no review panel
 * (that lands in a later slice). It reuses the review surface shell for
 * the tree / collapse / scroll mechanics and adds keyboard navigation
 * between files ("[" / "]") and hunks ("j" / "k").
 */
export function DiffView({ target }: { target: PrTarget }) {
  const [status, setStatus] = useState<Status>({ type: 'loading' })

  useEffect(() => {
    let cancelled = false
    setStatus({ type: 'loading' })
    window.api
      .githubGetPRDiff(target)
      .then(rawDiff => {
        if (!cancelled) setStatus({ type: 'loaded', files: splitPatchByFile(rawDiff) })
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
  return <DiffLoaded files={status.files} />
}

function DiffLoaded({ files }: { files: DiffFile[] }) {
  const codeViewRef = useRef<CodeViewHandle<AnnotationMeta>>(null)

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

  // Read-only surface: no annotations, no draft, no review panel.
  const annotationsByPath = useMemo(() => new Map<string, DiffLineAnnotation<AnnotationMeta>[]>(), [])
  // PR files are all text patches from GitHub; none carry a binary flag.
  const codeFiles = useMemo(() => files.map(f => ({ ...f, isBinary: false })), [files])
  const shell = useReviewSurfaceShell({ files: codeFiles, annotationsByPath, model, selectedPath, codeViewRef })

  // One ordered scroll target per hunk. The shell has already parsed each
  // patch into `fileDiff` for the CodeView, so we reuse those hunks rather
  // than re-parsing. The cursor walks this list; selecting a file re-seats
  // it at that file's first hunk.
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
      // Scroll to the hunk directly (not via file selection, which would
      // scroll to the file's start and fight this target).
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

  return (
    <ReviewSurface
      panesId="diff-panes"
      model={model}
      fileTreeOpen={shell.fileTreeOpen}
      treeSize="18%"
      diffSize="82%"
      panelSize="0%"
      codeViewRef={codeViewRef}
      diffSectionRef={shell.diffSectionRef}
      items={shell.codeViewItems}
      renderHeaderPrefix={shell.renderHeaderPrefix}
      emptyState="No diff to display"
    />
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
