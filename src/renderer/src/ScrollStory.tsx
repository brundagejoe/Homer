import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Markdown, InlineMarkdown } from './Markdown'
import { ReferencePanel } from './GuideReference'
import { cn } from '@/lib/utils'
import type { SectionKind } from '../../shared/guide-schema'
import type { ReferenceGroup, RenderableSection } from '../../shared/guide-view'
import { groupReferencesByFile } from '../../shared/guide-view'
import { choosePinSide, resolveActiveOrdinal, formatProgress, type PinSide } from './scroll-story-layout'

/**
 * ScrollStory — the quarantined scrollytelling renderer.
 *
 * This module owns ALL scroll choreography for the Guide behind one interface:
 * the sticky pin-side selection (which column stays put vs. drives the scroll),
 * the `ResizeObserver` that measures columns to make that choice, the
 * `IntersectionObserver` that tracks which Section the reader is on, and the
 * soft progress indicator. The rest of the app hands it the ordered Sections
 * and (optionally) a way to hear about progress — and touches no scroll math.
 *
 * It works while the Guide is still streaming: new Sections mount with their
 * own measurement/observation and simply extend the story. A trailing `footer`
 * (coverage note, "generating more…", error/retry) is rendered inside the
 * scroll flow after the last Section but is otherwise opaque to this module.
 */
/**
 * How one file's coalesced references are rendered. A Section's references are
 * grouped by file (`groupReferencesByFile`) into one panel per file, so this
 * receives a `ReferenceGroup`, not a single reference. Injected by the caller so
 * ScrollStory owns only layout/pinning/progress and stays ignorant of what a
 * reference panel does — the Guide tab passes an authoring-enabled renderer,
 * a plain reader gets the read-only default.
 */
export type RenderReference = (group: ReferenceGroup, key: string) => ReactNode

export interface ScrollStoryProps {
  /** The Sections to narrate, already ordered by the caller. */
  sections: RenderableSection[]
  /** Presentational trailing content, rendered inside the scroll flow. */
  footer?: ReactNode
  /** Renders each Section's Code References. Defaults to a read-only panel. */
  renderReference?: RenderReference
}

const defaultRenderReference: RenderReference = (group, key) => (
  <ReferencePanel key={key} group={group} />
)

/**
 * Registry of per-`kind` Section renderers. V1 registers exactly one (`code`);
 * the map is the open seam for future kinds (`diagram`, …) — each kind owns its
 * own layout while ScrollStory keeps the shared scroll/progress machinery.
 */
const SECTION_RENDERERS: Record<
  SectionKind,
  (props: { section: RenderableSection; renderReference: RenderReference }) => ReactElement
> = {
  code: CodeSection
}

export function ScrollStory({ sections, footer, renderReference = defaultRenderReference }: ScrollStoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const firstOrdinal = sections[0]?.ordinal ?? 0
  const [active, setActive] = useState(firstOrdinal)

  // Track which Sections are crossing the center progress line, and reduce that
  // set to the active ordinal. A zero-height line (rootMargin -50%/-50%) means
  // one Section is on it at a time, so this ticks in both scroll directions.
  const intersecting = useRef(new Set<number>())
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const ordinal = Number((entry.target as HTMLElement).dataset.ordinal)
          if (entry.isIntersecting) intersecting.current.add(ordinal)
          else intersecting.current.delete(ordinal)
        }
        setActive(prev => resolveActiveOrdinal(intersecting.current, prev))
      },
      { root, rootMargin: '-50% 0px -50% 0px', threshold: 0 }
    )
    root.querySelectorAll<HTMLElement>('[data-ordinal]').forEach(el => io.observe(el))
    return () => io.disconnect()
    // Re-observe as Sections stream in (count grows) so new steps join the story.
  }, [sections.length])

  // Keep the active ordinal valid as Sections stream in (e.g. before the first
  // observer callback fires).
  useEffect(() => {
    if (!sections.some(s => s.ordinal === active) && sections.length > 0) setActive(firstOrdinal)
  }, [sections, active, firstOrdinal])

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto bg-surface">
        <div className="max-w-[1700px] mx-auto px-6 py-10 flex flex-col gap-20">
          {sections.map(section => {
            const Renderer = SECTION_RENDERERS[section.kind]
            return (
              <div key={section.ordinal} data-ordinal={section.ordinal}>
                <Renderer section={section} renderReference={renderReference} />
              </div>
            )
          })}
          {footer && <div className="max-w-3xl">{footer}</div>}
        </div>
      </div>
      <ProgressIndicator current={active} total={sections.length} />
    </div>
  )
}

/**
 * A `code` Section: prose beside its Code References in two columns. The shorter
 * column pins (`sticky`) while the taller drives the scroll; the pin side is
 * chosen by measuring both columns' natural heights with a `ResizeObserver`, so
 * both the code-taller and prose-taller cases pin correctly. The row is
 * `items-start` (never stretch) so a column's measured height is its content
 * height and the pin choice can't feed back into the measurement.
 */
function CodeSection({
  section,
  renderReference
}: {
  section: RenderableSection
  renderReference: RenderReference
}) {
  const proseRef = useRef<HTMLDivElement>(null)
  const codeRef = useRef<HTMLDivElement>(null)
  const [pin, setPin] = useState<PinSide>('prose')

  useLayoutEffect(() => {
    const prose = proseRef.current
    const code = codeRef.current
    if (!prose || !code) return
    const measure = (): void =>
      setPin(choosePinSide({ proseHeight: prose.offsetHeight, codeHeight: code.offsetHeight }))
    const ro = new ResizeObserver(measure)
    ro.observe(prose)
    ro.observe(code)
    measure()
    return () => ro.disconnect()
  }, [])

  const stickyColumn = 'self-start sticky top-6 z-[1]'

  return (
    <article className="flex items-start gap-10">
      <div
        ref={proseRef}
        className={cn('w-[440px] shrink-0 min-w-0', pin === 'prose' && stickyColumn)}
      >
        <header className="flex items-baseline gap-2 pb-1.5 mb-3 border-b border-hairline">
          <span className="font-mono text-[11px] text-subtle tabular-nums">
            {String(section.ordinal).padStart(2, '0')}
          </span>
          <h2 className="m-0 type-title">
            <InlineMarkdown>{section.title}</InlineMarkdown>
          </h2>
        </header>
        <Markdown compact>{section.explanation}</Markdown>
      </div>
      <div ref={codeRef} className={cn('flex-1 min-w-0 flex flex-col gap-3', pin === 'code' && stickyColumn)}>
        {groupReferencesByFile(section.references).map((group, i) =>
          renderReference(group, `${group.path}-${i}`)
        )}
      </div>
    </article>
  )
}

/**
 * The soft `NN / NN` indicator. A floating pill — deliberately non-blocking (no
 * hard scroll-snap, `pointer-events-none`) — that ticks as the reader crosses
 * Section boundaries.
 */
function ProgressIndicator({ current, total }: { current: number; total: number }) {
  if (total === 0) return null
  return (
    <div className="pointer-events-none absolute top-4 right-6 z-10">
      <span className="glass rounded-full border border-hairline px-2.5 py-1 font-mono text-[11px] tabular-nums text-subtle shadow-sm">
        {formatProgress(current, total)}
      </span>
    </div>
  )
}
