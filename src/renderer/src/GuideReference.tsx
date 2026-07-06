import { useMemo } from 'react'
import { CodeView } from '@pierre/diffs/react'
import { processFile } from '@pierre/diffs'
import type { CodeViewItem } from '@pierre/diffs'
import { Badge } from '@/components/ui/badge'
import type { RenderableReference } from '../../shared/guide-view'

/**
 * One Code Reference: a labeled panel rendering changed code as a diff and
 * unchanged context as a full file, both via Pierre. Kept in its own file to
 * isolate the Pierre coupling out of the choreography module: `ScrollStory` is
 * the sole consumer today, and its `code` Section renderer (and any future
 * Section kinds) render a single reference through this layout-agnostic panel,
 * which knows nothing about scroll choreography.
 */
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
      {item ? (
        <CodeView className="max-h-[460px] overflow-auto" items={[item]} />
      ) : (
        <pre className="m-0 p-3 text-[12px] font-mono whitespace-pre-wrap text-danger">
          Could not render {reference.path}
        </pre>
      )}
    </div>
  )
}
