import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react'
import { processFile } from '@pierre/diffs'
import type { CodeViewDiffItem, DiffLineAnnotation } from '@pierre/diffs'
import { FileTree, type UseFileTreeResult } from '@pierre/trees/react'
import { useKeyboardShortcut } from './useKeyboardShortcut'
import { usePersistedBoolean } from './usePersistedBoolean'
import type { UseReviewDraft } from './useReviewDraft'
import type { AnchorSpec } from './review-draft'
import type { AnnotationMeta } from './diff-annotations'
import { Tooltip } from '@/components/ui/tooltip'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '@/components/ui/resizable'

type FileTreeModel = UseFileTreeResult['model']

/**
 * Shared className for Pierre's CodeView root, which IS the diff's
 * scroll container. The padding-bottom is the trailing space below the
 * last file. We rely on CSS padding (not Pierre's layout.paddingBottom,
 * which it applies as a child margin) because padding on the scroll
 * container is unambiguously part of scrollHeight per spec — so it
 * survives any future layout/contain tweaks.
 */
const CODE_VIEW_CLASS = 'flex-1 min-h-0 overflow-auto pb-24'

interface CodeFile {
  path: string
  patch: string
  isBinary: boolean
}

type Annotator<T> = (path: string) => DiffLineAnnotation<T>[] | undefined

/**
 * Normalize Pierre's SelectedLineRange (which may be reverse-ordered
 * if the user drags upward) into an AnchorSpec keyed to last line +
 * last side, with startLineNumber/startSide set only when the
 * selection actually covers more than one line.
 */
export function specFromRange(range: {
  start: number
  end: number
  side?: 'deletions' | 'additions'
  endSide?: 'deletions' | 'additions'
}): AnchorSpec {
  const sideStart = range.side === 'deletions' ? 'old' : 'new'
  const sideEnd = (range.endSide ?? range.side) === 'deletions' ? 'old' : 'new'
  const ascending = range.start <= range.end
  const firstLine = ascending ? range.start : range.end
  const lastLine = ascending ? range.end : range.start
  const firstSide = ascending ? sideStart : sideEnd
  const lastSide = ascending ? sideEnd : sideStart
  const isMulti = firstLine !== lastLine || firstSide !== lastSide
  return {
    lineNumber: lastLine,
    side: lastSide,
    ...(isMulti ? { startLineNumber: firstLine, startSide: firstSide } : {})
  }
}

function buildCodeViewItems<T>(
  files: CodeFile[],
  annotationsFor?: Annotator<T>,
  collapsedPaths?: ReadonlySet<string>
): CodeViewDiffItem<T>[] {
  const items: CodeViewDiffItem<T>[] = []
  for (const f of files) {
    if (f.isBinary || !f.patch) continue
    const fileDiff = processFile(f.patch)
    if (!fileDiff) continue
    const collapsed = collapsedPaths?.has(f.path) ?? false
    const annotations = annotationsFor?.(f.path)
    items.push({
      id: f.path,
      type: 'diff',
      fileDiff,
      annotations,
      collapsed,
      // Pierre keeps a cached snapshot per item and re-syncs only when
      // `version` changes (see syncItemRecord in @pierre/diffs). It
      // must change whenever collapse state OR the annotation list
      // changes — otherwise newly-added pending comments silently get
      // swallowed by the cached snapshot.
      version: (collapsed ? 1 : 0) + (annotations?.length ?? 0) * 2
    })
  }
  return items
}

function ChevronToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? ChevronRight : ChevronDown
  const label = collapsed ? 'Expand file' : 'Collapse file'
  return (
    <Tooltip content={label}>
      <button
        onClick={onToggle}
        aria-label={label}
        className="inline-flex items-center justify-center w-4 h-4 p-0 m-0 appearance-none bg-transparent border-0 rounded-none shadow-none text-subtle hover:text-fg hover:bg-hover/60 [-webkit-app-region:no-drag]"
      >
        <Icon size={12} strokeWidth={2.4} />
      </button>
    </Tooltip>
  )
}

export interface ReviewSurfaceShell {
  codeViewItems: CodeViewDiffItem<AnnotationMeta>[]
  diffSectionRef: Ref<HTMLElement>
  renderHeaderPrefix: (item: { id: string }) => ReactNode
  fileTreeOpen: boolean
  reviewPanelOpen: boolean
  codeMode: boolean
  setCodeMode: (next: boolean) => void
  openFile: (path: string) => void
  startReview: () => void
  startDraft: (spec: { path: string; anchor: AnchorSpec; inReplyToId?: number }) => void
}

/**
 * The mechanics of a review surface that are independent of authoring:
 * collapse state, the Pierre CodeView item list, scroll-to-selected-file,
 * the file-tree / panel layout toggles, and their keyboard shortcuts.
 *
 * Its only live consumer is the read-only Diff view; the drafting hooks
 * (`draft`, `startReview` / `startDraft`) are kept for when Line Comment
 * authoring lands. With no `draft` supplied they are no-ops.
 */
export function useReviewSurfaceShell(args: {
  files: CodeFile[]
  annotationsByPath: Map<string, DiffLineAnnotation<AnnotationMeta>[]>
  model: FileTreeModel
  selectedPath: string | undefined
  codeViewRef: RefObject<CodeViewHandle<AnnotationMeta> | null>
  /**
   * The Pending Review drafting machine. Optional: a read-only surface
   * (e.g. the Diff view before review authoring lands) reuses all the
   * shell's tree/collapse/scroll mechanics but has no draft — with none
   * supplied, review-authoring actions become no-ops.
   */
  draft?: UseReviewDraft
}): ReviewSurfaceShell {
  const { files, annotationsByPath, model, selectedPath, codeViewRef, draft } = args
  const pending = draft?.pending ?? null

  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  const toggleCollapsed = useCallback((path: string) => {
    setCollapsedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const codeViewItems = useMemo(
    () => buildCodeViewItems<AnnotationMeta>(files, p => annotationsByPath.get(p), collapsedPaths),
    [files, annotationsByPath, collapsedPaths]
  )

  const diffSectionRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!selectedPath) return
    setCollapsedPaths(prev => {
      if (!prev.has(selectedPath)) return prev
      const next = new Set(prev)
      next.delete(selectedPath)
      return next
    })
    // CodeView is virtualized — only on-screen files have DOM nodes, so
    // we can't locate the target by querying/indexing rendered elements.
    // Pierre's own scrollTo resolves the file by item id against its
    // virtual layout. rAF lets the items prop flush (e.g. after the
    // un-collapse above) before we ask it to scroll.
    requestAnimationFrame(() => {
      codeViewRef.current?.scrollTo({
        type: 'item',
        id: selectedPath,
        align: 'start',
        behavior: 'smooth'
      })
    })
  }, [selectedPath, codeViewRef])

  const renderHeaderPrefix = useCallback(
    (item: { id: string }) => (
      <ChevronToggle collapsed={collapsedPaths.has(item.id)} onToggle={() => toggleCollapsed(item.id)} />
    ),
    [collapsedPaths, toggleCollapsed]
  )

  const [fileTreeOpen, setFileTreeOpen] = usePersistedBoolean('file-tree-open', true)
  const [reviewPanelOpen, setReviewPanelOpen] = usePersistedBoolean('review-panel-open', true)
  const [codeMode, setCodeMode] = usePersistedBoolean('code-mode', true)

  const startReview = useCallback(() => {
    draft?.startReview()
    setReviewPanelOpen(true)
    setCodeMode(true)
  }, [draft, setReviewPanelOpen, setCodeMode])

  const startDraft = useCallback(
    (spec: { path: string; anchor: AnchorSpec; inReplyToId?: number }) => {
      draft?.startDraft(spec)
      setReviewPanelOpen(true)
    },
    [draft, setReviewPanelOpen]
  )

  useKeyboardShortcut({
    key: 'b',
    meta: true,
    allowInForm: true,
    handler: e => {
      e.preventDefault()
      setFileTreeOpen(v => !v)
    }
  })
  useKeyboardShortcut({
    key: 'e',
    meta: true,
    allowInForm: true,
    handler: e => {
      e.preventDefault()
      setCodeMode(v => !v)
    }
  })
  useKeyboardShortcut({
    key: 'l',
    meta: true,
    allowInForm: true,
    handler: e => {
      e.preventDefault()
      if (!pending) startReview()
      else setReviewPanelOpen(v => !v)
    }
  })

  const openFile = useCallback(
    (path: string) => {
      model.getItem(path)?.select()
      setCodeMode(true)
    },
    [model, setCodeMode]
  )

  return {
    codeViewItems,
    diffSectionRef,
    renderHeaderPrefix,
    fileTreeOpen,
    reviewPanelOpen,
    codeMode,
    setCodeMode,
    openFile,
    startReview,
    startDraft
  }
}

/**
 * The tree + diff + review-panel layout. Its only live consumer is the
 * read-only Diff view; the authoring pieces (gutter draft entry, line
 * selection, annotation rendering, and the review panel) are all gated
 * behind the single `enableAuthoring` seam for when Line Comment
 * authoring lands.
 */
export function ReviewSurface({
  panesId,
  model,
  fileTreeOpen,
  treeSize,
  diffSize,
  panelSize,
  codeViewRef,
  items,
  renderHeaderPrefix,
  enableAuthoring = false,
  onGutterDraft,
  renderAnnotation,
  emptyState,
  diffSectionRef,
  reviewPanel
}: {
  panesId: string
  model: FileTreeModel
  fileTreeOpen: boolean
  treeSize: string
  diffSize: string
  panelSize: string
  codeViewRef: Ref<CodeViewHandle<AnnotationMeta>>
  items: CodeViewDiffItem<AnnotationMeta>[]
  renderHeaderPrefix: (item: { id: string }) => ReactNode
  /**
   * The one authoring on/off decision for the surface. When on, the
   * gutter "+" utility, line selection, gutter-draft entry, and
   * annotation rendering all turn on together; when off (read-only,
   * the default), none of them render — no phantom "+" gutter.
   */
  enableAuthoring?: boolean
  onGutterDraft?: (spec: { path: string; anchor: AnchorSpec }) => void
  renderAnnotation?: (ann: DiffLineAnnotation<AnnotationMeta>) => ReactNode
  emptyState: ReactNode
  diffSectionRef: Ref<HTMLElement>
  reviewPanel?: ReactNode
}) {
  return (
    <ResizablePanelGroup orientation="horizontal" id={panesId} className="flex-1 min-h-0">
      {fileTreeOpen && (
        <>
          <ResizablePanel defaultSize={treeSize} minSize="10%" maxSize="40%" className="overflow-hidden">
            <aside className="w-full h-full overflow-auto bg-sidebar py-1.5">
              <FileTree model={model} />
            </aside>
          </ResizablePanel>
          <ResizableHandle />
        </>
      )}
      <ResizablePanel defaultSize={diffSize} minSize="30%" className="overflow-hidden">
        <section ref={diffSectionRef} className="diff-host w-full h-full flex flex-col">
          {items.length > 0 ? (
            <CodeView<AnnotationMeta>
              ref={codeViewRef}
              className={CODE_VIEW_CLASS}
              items={items}
              renderHeaderPrefix={renderHeaderPrefix}
              options={
                enableAuthoring
                  ? {
                      enableGutterUtility: true,
                      // Show the highlighted range while the user drags
                      // from the gutter +. Without this the drag-select
                      // still works data-wise, but there's no visual cue
                      // so it feels like dragging does nothing.
                      enableLineSelection: true,
                      onGutterUtilityClick: (range, ctx) =>
                        onGutterDraft?.({ path: ctx.item.id, anchor: specFromRange(range) })
                    }
                  : {}
              }
              renderAnnotation={renderAnnotation}
            />
          ) : (
            <div className="p-4 text-subtle">{emptyState}</div>
          )}
        </section>
      </ResizablePanel>
      {reviewPanel && (
        <>
          <ResizableHandle />
          <ResizablePanel defaultSize={panelSize} minSize="15%" maxSize="45%" className="overflow-hidden">
            {reviewPanel}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  )
}
