import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PrTarget } from '../../preload'
import type { CoverageMap } from '../../shared/guide-schema'
import type { RenderableSection } from '../../shared/guide-view'
import { ScrollStory, type RenderReference } from './ScrollStory'
import { GuideReferencePanel } from './GuideReference'
import { openSettings } from './SettingsDialog'
import type { UseReviewDraft } from './useReviewDraft'

/**
 * The Guide's lifecycle from the renderer's point of view:
 *  - `generating`: started, nothing streamed yet ("by the time you've read the
 *    description it's ready" — user story 4).
 *  - `streaming`: Sections arriving; readable already.
 *  - `done`: finalized, Coverage Map in hand.
 *  - `error`: the Agent failed — keep whatever streamed and offer a retry.
 */
type GuideStatus = 'generating' | 'streaming' | 'done' | 'error'

export interface GuideState {
  sections: RenderableSection[]
  status: GuideStatus
  error?: string
  /** The Guide failed because no local clone of the PR's repo was found —
   *  fixable in Settings → Repository roots; surfaces an "Open Settings" nudge. */
  settingsHint?: boolean
  coverage?: CoverageMap
}

/**
 * Start generating the Guide and accumulate streamed Sections. Called once when
 * the Window mounts — i.e. at launch, in the background, while the reviewer reads
 * Activity — not gated on the Guide tab being open. The renderer touches no
 * generation internals: it starts generation, collects the streamed events, and
 * keeps Sections ordered. Generation is additive — an error leaves the
 * already-streamed Sections in place and exposes `retry`.
 */
export function useGuide(target: PrTarget): GuideState & { retry: () => void } {
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<GuideState>({ sections: [], status: 'generating' })

  useEffect(() => {
    // A fresh token per run. Every streamed event echoes it back, so events from
    // a superseded run (e.g. after navigating to another PR, or a retry) are
    // dropped even if a late send races the effect teardown.
    const generationId = crypto.randomUUID()
    setState({ sections: [], status: 'generating' })

    const offSection = window.api.onGuideSection(({ generationId: id, section }) => {
      if (id !== generationId) return
      setState(prev => {
        const sections = [...prev.sections.filter(s => s.ordinal !== section.ordinal), section].sort(
          (a, b) => a.ordinal - b.ordinal
        )
        return { ...prev, sections, status: prev.status === 'done' ? 'done' : 'streaming' }
      })
    })
    const offFinalized = window.api.onGuideFinalized(({ generationId: id, coverage }) => {
      if (id !== generationId) return
      setState(prev => ({ ...prev, status: 'done', coverage }))
    })
    const offError = window.api.onGuideError(({ generationId: id, message, settingsHint }) => {
      if (id !== generationId) return
      setState(prev => ({ ...prev, status: 'error', error: message, settingsHint }))
    })

    window.api.startGuide(target, generationId)

    return () => {
      offSection()
      offFinalized()
      offError()
    }
  }, [target.owner, target.repo, target.number, nonce])

  return { ...state, retry: () => setNonce(n => n + 1) }
}

/**
 * The Guide View: presents the streamed Guide as a scrollytelling story. It owns
 * only generation *state* — the empty/error gates and the trailing streaming /
 * error / coverage footer — and hands the ordered Sections to `ScrollStory`,
 * which quarantines every bit of scroll choreography (sticky pinning, column
 * measurement, progress observation). This component touches no scroll math.
 * Sections appear as they stream in; the story extends live.
 */
export function GuideView({
  guide,
  onRetry,
  draft,
  diffLoaded = false
}: {
  guide: GuideState
  onRetry: () => void
  /** The shared Pending Review draft. Enables changed-lines-only Line
   *  Comment authoring on diff references; omit for a read-only Guide. */
  draft?: UseReviewDraft
  /** Whether the diff has loaded — authoring is gated on it (ADR 0001). */
  diffLoaded?: boolean
}) {
  const { sections, status, error, settingsHint, coverage } = guide

  // Author into the shared draft on changed (diff) references once the diff has
  // loaded; context (full) references and the pre-load window stay read-only
  // (GuideReferencePanel enforces this via isGuideAuthoringEnabled). Without a
  // draft, ScrollStory falls back to its read-only reference panel.
  const renderReference = useMemo<RenderReference | undefined>(
    () =>
      draft
        ? (group, key) => (
            <GuideReferencePanel
              key={key}
              group={group}
              draft={draft}
              startDraft={draft.startDraft}
              diffLoaded={diffLoaded}
            />
          )
        : undefined,
    [draft, diffLoaded]
  )

  if (sections.length === 0 && (status === 'generating' || status === 'streaming')) {
    return <CenteredNote>Generating the Guide…</CenteredNote>
  }
  if (sections.length === 0 && status === 'error') {
    return (
      <CenteredNote tone="danger">
        <span>Guide generation failed: {error}</span>
        <ErrorActions onRetry={onRetry} settingsHint={settingsHint} />
      </CenteredNote>
    )
  }

  const footer = (
    <div className="flex flex-col gap-3">
      {(status === 'generating' || status === 'streaming') && (
        <p className="m-0 text-[12.5px] text-subtle italic">Generating more sections…</p>
      )}
      {status === 'error' && (
        <div className="flex items-center gap-3 border-t border-hairline pt-4">
          <p className="m-0 text-[12.5px] text-danger">Guide generation failed: {error}</p>
          <ErrorActions onRetry={onRetry} settingsHint={settingsHint} />
        </div>
      )}
      {status === 'done' && coverage && <CoverageNote coverage={coverage} />}
    </div>
  )

  return <ScrollStory sections={sections} footer={footer} renderReference={renderReference} />
}

/**
 * Actions offered when generation fails: always a Retry; plus an "Open Settings"
 * nudge when the failure was that no local clone of the PR's repo could be found
 * (fixable by adding a repository root).
 */
function ErrorActions({ onRetry, settingsHint }: { onRetry: () => void; settingsHint?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {settingsHint && (
        <Button size="sm" variant="primary" onClick={openSettings}>
          Open Settings
        </Button>
      )}
      <Button size="sm" onClick={onRetry}>
        Retry
      </Button>
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
      <div
        className={cn(
          'm-0 text-[13px] text-center flex flex-col items-center gap-3',
          tone === 'danger' ? 'text-danger' : 'text-subtle'
        )}
      >
        {children}
      </div>
    </section>
  )
}
