import type { RenderableSection } from '../shared/guide-view'
import type { GuideEvent, GuideRequest, GuideSource } from './guide-source'
import type { GuideKey, GuideStore } from './guide-store'

export interface CachingGuideSourceDeps {
  /** The real generation seam used on a cache miss (in production: `AgentRunner`). */
  inner: GuideSource
  /** The disposable Guide cache, keyed by (repo, PR, head SHA). */
  store: GuideStore
}

/**
 * The cache-first Guide seam: wraps another `GuideSource` so that re-opening a
 * PR at a head SHA it already generated for replays the cached Guide instantly —
 * the same section/finalized events a fresh run would emit — WITHOUT ever calling
 * the inner source (no worktree acquire, no `claude` spawn). On a miss it
 * delegates to the inner source and caches the finished Guide on `finalize` so
 * the next open at that SHA hits.
 *
 * The head SHA — the last axis of the cache key — is resolved ONCE upstream (the
 * `guide:generate` IPC handler) and travels in `request.headSha`, so the SHA the
 * cache is keyed by and the SHA the inner source generates against are always the
 * same value; a commit landing mid-flight can never mis-key the cache.
 *
 * Implementing `GuideSource` itself keeps this behind the existing seam: callers
 * (the `guide:generate` IPC handler) see no difference from talking to the Agent
 * directly. Composition lives in `services.ts`.
 */
export class CachingGuideSource implements GuideSource {
  constructor(private readonly deps: CachingGuideSourceDeps) {}

  async *generate(request: GuideRequest, signal?: AbortSignal): AsyncIterable<GuideEvent> {
    if (signal?.aborted) return

    const key: GuideKey = {
      owner: request.owner,
      repo: request.repo,
      number: request.number,
      headSha: request.headSha
    }

    // Cache hit: replay the exact events a fresh run would emit, instantly, and
    // return WITHOUT touching the inner source — no worktree acquire, no `claude`.
    const cached = this.deps.store.get(key)
    if (cached) {
      for (const section of cached.sections) {
        if (signal?.aborted) return
        yield { type: 'section', section }
      }
      if (signal?.aborted) return
      yield { type: 'finalized', coverage: cached.coverage }
      return
    }

    // Cache miss: run the real Agent, streaming its events straight through while
    // accumulating them so a complete run (one that reaches `finalize`) is cached.
    const sections: RenderableSection[] = []
    for await (const event of this.deps.inner.generate(request, signal)) {
      if (signal?.aborted) return
      if (event.type === 'section') {
        sections.push(event.section)
        yield event
      } else {
        yield event
        // Only a finished Guide is cached — an aborted or errored run never
        // reaches here, so half-generated Guides are never stored.
        this.deps.store.put(key, { sections, coverage: event.coverage })
      }
    }
  }
}
