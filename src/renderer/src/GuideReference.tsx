import { useMemo, useRef, type ReactNode } from 'react'
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react'
import { processFile } from '@pierre/diffs'
import type { CodeViewItem } from '@pierre/diffs'
import { Badge } from '@/components/ui/badge'
import { isGuideAuthoringEnabled, type RenderableReference } from '../../shared/guide-view'
import { buildAuthoringOptions, buildCodeViewItems, useClearSelectionWhenIdle } from './ReviewSurface'
import { buildAnnotationMap, type AnnotationMeta } from './diff-annotations'
import { draftComments, makeReviewAnnotationRenderer } from './review-comments'
import type { UseReviewDraft } from './useReviewDraft'
import type { AnchorSpec } from './review-draft'

/**
 * One Code Reference: a labeled panel rendering changed code as a diff and
 * unchanged context as a full file, both via Pierre. Kept in its own file to
 * isolate the Pierre coupling out of the choreography module: `ScrollStory` is
 * the sole consumer today, and its `code` Section renderer (and any future
 * Section kinds) render a single reference through this layout-agnostic panel,
 * which knows nothing about scroll choreography.
 *
 * `ReferencePanel` is the read-only view; `GuideReferencePanel` adds the
 * changed-lines-only Line Comment authoring the Guide tab wires in (slice #29)
 * by reusing the shared review kit — no new comment UI lives here.
 */
const CODE_VIEW_CLASS = 'max-h-[460px] overflow-auto'

/** Chrome shared by the read-only and authoring reference panels. */
function PanelShell({ reference, children }: { reference: RenderableReference; children: ReactNode }) {
  return (
    <div className="border border-hairline rounded-lg overflow-hidden bg-elevated">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-hairline bg-sidebar">
        <span className="font-mono text-[11.5px] text-fg truncate">{reference.path}</span>
        <span className="text-[11px] text-subtle">
          L{reference.lineRange.start}–{reference.lineRange.end}
        </span>
        <Badge tone={reference.renderMode === 'diff' ? 'purple' : 'neutral'} className="ml-auto">
          {reference.renderMode === 'diff' ? 'changed · diff' : 'context · full'}
        </Badge>
      </div>
      {children}
    </div>
  )
}

function CouldNotRender({ path }: { path: string }) {
  return (
    <pre className="m-0 p-3 text-[12px] font-mono whitespace-pre-wrap text-danger">
      Could not render {path}
    </pre>
  )
}

export function ReferencePanel({ reference }: { reference: RenderableReference }) {
  const item = useMemo<CodeViewItem | null>(() => {
    if (reference.renderMode === 'diff') {
      const fileDiff = processFile(reference.content)
      return fileDiff ? { id: reference.path, type: 'diff', fileDiff } : null
    }
    return {
      id: reference.path,
      type: 'file',
      file: { name: reference.path, contents: reference.content }
    }
  }, [reference])

  return (
    <PanelShell reference={reference}>
      {item ? (
        <CodeView className={CODE_VIEW_CLASS} items={[item]} />
      ) : (
        <CouldNotRender path={reference.path} />
      )}
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
  reference,
  draft,
  startDraft,
  diffLoaded
}: {
  reference: RenderableReference
  draft: UseReviewDraft
  startDraft: (spec: { path: string; anchor: AnchorSpec; inReplyToId?: number }) => void
  /** Whether the `base...head` diff has loaded (its snapshot is available). */
  diffLoaded: boolean
}) {
  if (!isGuideAuthoringEnabled(reference, diffLoaded)) return <ReferencePanel reference={reference} />
  return <AuthoringDiffReference reference={reference} draft={draft} startDraft={startDraft} />
}

function AuthoringDiffReference({
  reference,
  draft,
  startDraft
}: {
  reference: RenderableReference
  draft: UseReviewDraft
  startDraft: (spec: { path: string; anchor: AnchorSpec; inReplyToId?: number }) => void
}) {
  const codeViewRef = useRef<CodeViewHandle<AnnotationMeta>>(null)
  const { pending, editing } = draft

  // Only the in-progress Review's comments render here (pending + in-flight
  // drafts); the annotations are naturally scoped to this reference's hunk
  // because Pierre only renders those whose line exists in the item.
  const annotationsByPath = useMemo(
    () => buildAnnotationMap({ pending: pending?.lineComments, drafts: draftComments(editing) }),
    [pending, editing]
  )
  const items = useMemo(
    () =>
      buildCodeViewItems<AnnotationMeta>(
        [{ path: reference.path, patch: reference.content, isBinary: false }],
        p => annotationsByPath.get(p)
      ),
    [reference.path, reference.content, annotationsByPath]
  )
  const renderAnnotation = useMemo(
    () => makeReviewAnnotationRenderer({ draft, startDraft }),
    [draft, startDraft]
  )
  useClearSelectionWhenIdle(codeViewRef, editing.size)

  return (
    <PanelShell reference={reference}>
      {items.length > 0 ? (
        <CodeView<AnnotationMeta>
          ref={codeViewRef}
          className={CODE_VIEW_CLASS}
          items={items}
          options={buildAuthoringOptions(startDraft)}
          renderAnnotation={renderAnnotation}
        />
      ) : (
        <CouldNotRender path={reference.path} />
      )}
    </PanelShell>
  )
}
