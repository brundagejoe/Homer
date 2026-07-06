import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CodeView, FileDiff, type CodeViewHandle } from '@pierre/diffs/react'
import { processFile } from '@pierre/diffs'
import type { CodeViewItem, FileDiffOptions, SelectedLineRange } from '@pierre/diffs'
import { Badge } from '@/components/ui/badge'
import { isGuideAuthoringEnabled, type ReferenceGroup } from '../../shared/guide-view'
import { slicePatchToRanges } from '../../shared/patch-slice'
import { specFromRange } from './ReviewSurface'
import { buildAnnotationMap, type AnnotationMeta } from './diff-annotations'
import { draftComments, makeReviewAnnotationRenderer } from './review-comments'
import type { UseReviewDraft } from './useReviewDraft'
import type { AnchorSpec } from './review-draft'

/**
 * One file's coalesced Code References: a labeled panel rendering changed code
 * as a diff and unchanged context as a full file. Takes a `ReferenceGroup` —
 * every span a Section pointed at in one file — so a file referenced at three
 * spans renders ONE panel scoped to those spans, not the whole file three
 * times. Diff panels slice the file's patch to the hunks overlapping the group's
 * ranges (`slicePatchToRanges`) before handing it to Pierre; full panels scroll
 * the first range into view. Kept in its own file to isolate the Pierre coupling
 * out of the choreography module: `ScrollStory` is the sole consumer today, and
 * its `code` Section renderer (and any future Section kinds) render a group
 * through this layout-agnostic panel, which knows nothing about scroll
 * choreography.
 *
 * `ReferencePanel` is the read-only view; `GuideReferencePanel` adds the
 * changed-lines-only Line Comment authoring the Guide tab wires in (slice #29)
 * by reusing the shared review kit — no new comment UI lives here.
 *
 * Rendering splits by kind so the whole Guide page scrolls as one:
 *   - DIFF references are small (a hunk or two) and render with Pierre's
 *     non-virtualized `FileDiff` at their NATURAL FULL HEIGHT — no inner
 *     scroll box — so the outer `ScrollStory` page scroll handles everything.
 *   - FULL/context references are WHOLE FILES and can be arbitrarily large, so
 *     they stay on the virtualized `CodeView` inside a bounded scroll box; a
 *     huge file rendered full-height would blow up the page.
 */
const CODE_VIEW_CLASS = 'max-h-[460px] overflow-auto'

/**
 * The Guide column is narrow, so its diff panels render in Pierre's INLINE
 * (unified, single-column) view — split's old|new columns clip code off the
 * right. `overflow: 'wrap'` wraps long lines to the panel width instead of
 * scrolling horizontally: it keeps everything in view in a narrative guide
 * AND bounds the diff content to the visible width, so inline review-comment
 * cards (rendered in Pierre's annotation slot) wrap instead of running off the
 * right edge past the widest code line. The Diff tab keeps split + scroll (it
 * has full width); this is Guide-only.
 */
const GUIDE_DIFF_OPTIONS: FileDiffOptions<undefined> = { diffStyle: 'unified', overflow: 'wrap' }

/**
 * Lines of context to keep on each side of a full-file reference's `lineRange`
 * when scrolling it into view, so the target span sits with a little breathing
 * room rather than flush against the panel's top edge.
 */
const FULL_REF_SCROLL_PADDING = 3

/** Chrome shared by the read-only and authoring reference panels. */
function PanelShell({ group, children }: { group: ReferenceGroup; children: ReactNode }) {
  return (
    <div className="border border-hairline rounded-lg overflow-hidden bg-elevated">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-hairline bg-sidebar">
        <span className="font-mono text-[11.5px] text-fg truncate">{group.path}</span>
        <span className="text-[11px] text-subtle whitespace-nowrap">{rangeLabel(group.ranges)}</span>
        <Badge tone={group.renderMode === 'diff' ? 'purple' : 'neutral'} className="ml-auto">
          {group.renderMode === 'diff' ? 'changed · diff' : 'context · full'}
        </Badge>
      </div>
      {children}
    </div>
  )
}

/**
 * The header's span label: a single `L..–..` when the group covers one span,
 * else a compact `N spots` count so several spans don't overflow the narrow
 * panel header.
 */
function rangeLabel(ranges: ReferenceGroup['ranges']): string {
  if (ranges.length === 1) return `L${ranges[0].start}–${ranges[0].end}`
  return `${ranges.length} spots`
}

function CouldNotRender({ path }: { path: string }) {
  return (
    <pre className="m-0 p-3 text-[12px] font-mono whitespace-pre-wrap text-danger">
      Could not render {path}
    </pre>
  )
}

export function ReferencePanel({ group }: { group: ReferenceGroup }) {
  return group.renderMode === 'diff' ? (
    <ReadonlyDiffReference group={group} />
  ) : (
    <FullReference group={group} />
  )
}

/**
 * A changed (diff) reference, read-only. Rendered with the non-virtualized
 * `FileDiff` so the diff lays out at its natural height with no inner scroll —
 * the panel body is not height-capped; the outer page scroll takes over. The
 * `PanelShell`'s `overflow-hidden` only rounds the corners: the div has no
 * fixed height, so it grows to fit the full diff rather than clipping it.
 */
function ReadonlyDiffReference({ group }: { group: ReferenceGroup }) {
  const fileDiff = useMemo(
    () => processFile(slicePatchToRanges(group.content, group.ranges)),
    [group.content, group.ranges]
  )
  return (
    <PanelShell group={group}>
      {fileDiff ? (
        <FileDiff fileDiff={fileDiff} options={GUIDE_DIFF_OPTIONS} />
      ) : (
        <CouldNotRender path={group.path} />
      )}
    </PanelShell>
  )
}

/**
 * A context (full-file) reference. Full-file references carry the WHOLE file
 * text so the real line numbers survive; they can be arbitrarily large, so
 * they stay on the virtualized `CodeView` inside a bounded scroll box. We
 * window it to the referenced span by scrolling the target into view on mount
 * (Pierre's `type:'file'` item has no line-offset).
 */
function FullReference({ group }: { group: ReferenceGroup }) {
  const codeViewRef = useRef<CodeViewHandle<undefined>>(null)
  const item = useMemo<CodeViewItem>(
    () => ({
      id: group.path,
      type: 'file',
      file: { name: group.path, contents: group.content }
    }),
    [group.path, group.content]
  )

  const firstLine = group.ranges[0].start
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      codeViewRef.current?.scrollTo({
        type: 'line',
        id: group.path,
        lineNumber: Math.max(firstLine - FULL_REF_SCROLL_PADDING, 1),
        align: 'start',
        behavior: 'instant'
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [group.path, firstLine])

  return (
    <PanelShell group={group}>
      <CodeView ref={codeViewRef} className={CODE_VIEW_CLASS} items={[item]} />
    </PanelShell>
  )
}

/**
 * A reference panel that enables Line Comment authoring where the Guide
 * permits it. Changed (diff) references get the same gutter/annotation
 * authoring path the Diff tab uses; context (full) references stay read-only,
 * and so does everything until the diff has loaded — the changed-lines-only
 * rule and the ADR 0001 snapshot gate (`isGuideAuthoringEnabled`). The draft
 * is the shared Pending Review, so comments authored here accumulate with
 * those from the Diff tab.
 */
export function GuideReferencePanel({
  group,
  draft,
  startDraft,
  diffLoaded
}: {
  group: ReferenceGroup
  draft: UseReviewDraft
  startDraft: (spec: { path: string; anchor: AnchorSpec; inReplyToId?: number }) => void
  /** Whether the `base...head` diff has loaded (its snapshot is available). */
  diffLoaded: boolean
}) {
  if (!isGuideAuthoringEnabled({ renderMode: group.renderMode }, diffLoaded)) {
    return <ReferencePanel group={group} />
  }
  return <AuthoringDiffReference group={group} draft={draft} startDraft={startDraft} />
}

function AuthoringDiffReference({
  group,
  draft,
  startDraft
}: {
  group: ReferenceGroup
  draft: UseReviewDraft
  startDraft: (spec: { path: string; anchor: AnchorSpec; inReplyToId?: number }) => void
}) {
  const { pending, editing } = draft

  const fileDiff = useMemo(
    () => processFile(slicePatchToRanges(group.content, group.ranges)),
    [group.content, group.ranges]
  )

  // Only the in-progress Review's comments render here (pending + in-flight
  // drafts); the annotations are naturally scoped to this reference's hunk
  // because Pierre only renders those whose line exists in the diff.
  const lineAnnotations = useMemo(
    () =>
      buildAnnotationMap({ pending: pending?.lineComments, drafts: draftComments(editing) }).get(
        group.path
      ),
    [pending, editing, group.path]
  )
  const renderAnnotation = useMemo(
    () => makeReviewAnnotationRenderer({ draft, startDraft }),
    [draft, startDraft]
  )

  // FileDiff exposes no imperative handle (unlike CodeView's
  // `clearSelectedLines`), so we drive the drag-selection as a CONTROLLED
  // value: `onLineSelectionChange` paints it during the gutter drag, and we
  // clear it to null once no draft editor is open (the editing buffer emptied
  // after a commit or cancel) so the blue gutter selection doesn't linger.
  // Keyed on the editing count so it fires on the 1→0 edge, matching the Diff
  // tab's `useClearSelectionWhenIdle`.
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null)
  useEffect(() => {
    if (editing.size === 0) setSelectedLines(null)
  }, [editing.size])

  const options = useMemo<FileDiffOptions<AnnotationMeta>>(
    () => ({
      diffStyle: 'unified',
      overflow: 'wrap',
      enableGutterUtility: true,
      // Show the highlighted range while the user drags from the gutter +;
      // without it the drag-select works data-wise but gives no visual cue.
      enableLineSelection: true,
      onGutterUtilityClick: range =>
        startDraft({ path: group.path, anchor: specFromRange(range) }),
      onLineSelectionChange: setSelectedLines
    }),
    [group.path, startDraft]
  )

  return (
    <PanelShell group={group}>
      {fileDiff ? (
        <FileDiff<AnnotationMeta>
          fileDiff={fileDiff}
          options={options}
          lineAnnotations={lineAnnotations}
          selectedLines={selectedLines}
          renderAnnotation={renderAnnotation}
        />
      ) : (
        <CouldNotRender path={group.path} />
      )}
    </PanelShell>
  )
}
