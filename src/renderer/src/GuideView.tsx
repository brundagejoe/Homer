import { useEffect, useMemo, useState } from 'react'
import { CodeView } from '@pierre/diffs/react'
import { processFile } from '@pierre/diffs'
import type { CodeViewItem } from '@pierre/diffs'
import { Markdown } from './Markdown'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { PrTarget } from '../../preload'
import type { CoverageMap } from '../../shared/guide-schema'
import type { RenderableReference, RenderableSection } from '../../shared/guide-view'

type GuideStatus = 'streaming' | 'done' | 'error'

interface GuideState {
  sections: RenderableSection[]
  status: GuideStatus
  error?: string
  coverage?: CoverageMap
}

/**
 * Subscribe to the streamed Guide for a PR and accumulate Sections as they
 * arrive. The renderer touches no generation internals: it starts generation,
 * collects `section-emitted` / `guide-finalized` / `error` events, and keeps
 * Sections ordered by ordinal. Generation is additive — an error leaves the
 * already-streamed Sections in place.
 */
function useStreamingGuide(target: PrTarget): GuideState {
  const [state, setState] = useState<GuideState>({ sections: [], status: 'streaming' })

  useEffect(() => {
    setState({ sections: [], status: 'streaming' })

    const offSection = window.api.onGuideSection(section => {
      setState(prev => {
        const sections = [...prev.sections.filter(s => s.ordinal !== section.ordinal), section].sort(
          (a, b) => a.ordinal - b.ordinal
        )
        return { ...prev, sections }
      })
    })
    const offFinalized = window.api.onGuideFinalized(coverage => {
      setState(prev => ({ ...prev, status: 'done', coverage }))
    })
    const offError = window.api.onGuideError(err => {
      setState(prev => ({ ...prev, status: 'error', error: err.message }))
    })

    window.api.startGuide(target)

    return () => {
      offSection()
      offFinalized()
      offError()
    }
  }, [target.owner, target.repo, target.number])

  return state
}

/**
 * The Guide View: renders the streamed Guide as a basic, static top-to-bottom
 * list of Sections — each is tight prose beside its Code References (changed
 * refs as a diff, unchanged context as full file text). Sections appear as they
 * stream in. Scrollytelling (sticky pinning + scroll progress) is a later slice;
 * this view intentionally does no scroll choreography.
 */
export function GuideView({ target }: { target: PrTarget }) {
  const { sections, status, error, coverage } = useStreamingGuide(target)

  if (sections.length === 0 && status === 'streaming') {
    return <CenteredNote>Generating the Guide…</CenteredNote>
  }
  if (sections.length === 0 && status === 'error') {
    return <CenteredNote tone="danger">Guide generation failed: {error}</CenteredNote>
  }

  const total = sections.length

  return (
    <section className="flex-1 min-h-0 overflow-auto bg-surface">
      <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col gap-8">
        {sections.map(section => (
          <SectionCard key={section.ordinal} section={section} total={total} status={status} />
        ))}

        {status === 'streaming' && (
          <p className="m-0 text-[12.5px] text-subtle italic">Generating more sections…</p>
        )}
        {status === 'error' && (
          <p className="m-0 text-[12.5px] text-danger">Guide generation failed: {error}</p>
        )}
        {status === 'done' && coverage && <CoverageNote coverage={coverage} />}
      </div>
    </section>
  )
}

/**
 * The progress indicator counts against sections streamed so far while
 * streaming, and against the final total once finalized — a soft `NN/NN`
 * ordinal, no scroll math.
 */
function SectionCard({
  section,
  total,
  status
}: {
  section: RenderableSection
  total: number
  status: GuideStatus
}) {
  const denominator = status === 'done' ? String(total).padStart(2, '0') : '··'
  return (
    <article className="flex flex-col gap-3">
      <header className="flex items-baseline gap-2 pb-1 border-b border-hairline">
        <span className="font-mono text-[11px] text-subtle tabular-nums">
          {String(section.ordinal).padStart(2, '0')}/{denominator}
        </span>
        <h2 className="m-0 text-[16px] font-semibold leading-snug">{section.title}</h2>
      </header>
      <Markdown compact>{section.explanation}</Markdown>
      <div className="flex flex-col gap-3">
        {section.references.map((ref, i) => (
          <ReferencePanel key={`${ref.path}-${i}`} reference={ref} />
        ))}
      </div>
    </article>
  )
}

/** One Code Reference: a labeled panel rendering changed code as a diff and
 *  unchanged context as a full file, both via Pierre. */
function ReferencePanel({ reference }: { reference: RenderableReference }) {
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

/**
 * A short, honest note that the Guide is deliberately selective — it narrates
 * the arc, not every hunk, and the Diff view is the completeness backstop.
 */
function CoverageNote({ coverage }: { coverage: CoverageMap }) {
  const omitted = coverage.omitted.length
  if (omitted === 0) {
    return (
      <p className="m-0 text-[12.5px] text-subtle italic border-t border-hairline pt-4">
        The Guide narrated every changed hunk.
      </p>
    )
  }
  return (
    <p className="m-0 text-[12.5px] text-subtle italic border-t border-hairline pt-4">
      The Guide is deliberately selective: {omitted} changed hunk{omitted === 1 ? '' : 's'} went
      un-narrated. The Diff view flags them so nothing hides.
    </p>
  )
}

function CenteredNote({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <section className="flex-1 grid place-items-center px-6">
      <p
        className={cn(
          'm-0 text-[13px] text-center',
          tone === 'danger' ? 'text-danger' : 'text-subtle'
        )}
      >
        {children}
      </p>
    </section>
  )
}
