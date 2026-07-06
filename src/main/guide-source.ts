import { CodeReference, CoverageMap, parseEmitSection, parseFinalizeGuide } from '../shared/guide-schema'
import type { RenderableSection } from '../shared/guide-view'

/** What the generation layer streams out. */
export type GuideEvent =
  | { type: 'section'; section: RenderableSection }
  | { type: 'finalized'; coverage: CoverageMap }

export interface GuideRequest {
  owner: string
  repo: string
  number: number
}

/**
 * The generation seam. Hides the Agent, its subprocess, and its tool-hosting
 * behind one method that streams validated, content-resolved Sections followed
 * by the finalize-time Coverage Map. V1 has a stub implementation; the real
 * `claude` subprocess (`AgentRunner`) lands in a later slice behind this same
 * interface.
 */
export interface GuideSource {
  /**
   * Stream the Guide for a PR. The optional `signal` cancels an in-flight run:
   * implementations must stop promptly and tear down any subprocess when it
   * aborts, so navigating to another PR never leaks a generation.
   */
  generate(request: GuideRequest, signal?: AbortSignal): AsyncIterable<GuideEvent>
}

/** Resolves a validated Code Reference pointer to its displayable content. */
export type ReferenceResolver = (ref: CodeReference) => Promise<string>

/**
 * Hosts the `emit_section` / `finalize_guide` tools the Agent calls — the single
 * place raw Agent payloads cross the trust boundary into the app. Every payload
 * is validated through GuideSchema before anything else touches it; references
 * are then resolved to displayable content. Reused unchanged by the real
 * `AgentRunner` once it lands.
 */
export class GuideToolHost {
  constructor(private readonly resolve: ReferenceResolver) {}

  /** Validate an `emit_section` payload and resolve its references. Throws on invalid input. */
  async emitSection(raw: unknown): Promise<RenderableSection> {
    const section = parseEmitSection(raw)
    const references = await Promise.all(
      section.references.map(async ref => ({ ...ref, content: await this.resolve(ref) }))
    )
    return { ...section, references }
  }

  /** Validate a `finalize_guide` payload into a Coverage Map. Throws on invalid input. */
  finalizeGuide(raw: unknown): CoverageMap {
    return parseFinalizeGuide(raw)
  }
}

/**
 * A canned Agent that drives the whole pipe without a subprocess: it feeds
 * hand-written, multi-reference `emit_section` payloads through the REAL tool
 * host (so the contract, validation, and content-resolution paths are exercised
 * exactly as the live Agent will), streaming one Section at a time before
 * declaring coverage. Proves the pipe end-to-end before slice #26 wires up
 * `claude`. Offline and deterministic — its references resolve from a canned
 * content map, so it never touches the network or a worktree.
 */
export class StubGuideSource implements GuideSource {
  constructor(private readonly stepDelayMs = 350) {}

  async *generate(_request: GuideRequest, signal?: AbortSignal): AsyncIterable<GuideEvent> {
    const host = new GuideToolHost(cannedResolver)

    for (const payload of STUB_SECTION_PAYLOADS) {
      if (signal?.aborted) return
      const section = await host.emitSection(payload)
      yield { type: 'section', section }
      if (this.stepDelayMs > 0) await delay(this.stepDelayMs)
    }

    if (signal?.aborted) return
    yield { type: 'finalized', coverage: host.finalizeGuide(STUB_FINALIZE_PAYLOAD) }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Canned content per referenced path. Diff refs carry a patch; full refs, file text. */
const CANNED_CONTENT: Record<string, string> = {
  'src/shared/guide-schema.ts': `diff --git a/src/shared/guide-schema.ts b/src/shared/guide-schema.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/shared/guide-schema.ts
@@ -0,0 +1,6 @@
+export function parseEmitSection(raw: unknown): Section {
+  const obj = asObject(raw, 'emit_section')
+  // ...validate every field across the Agent → app trust boundary...
+  return { ordinal, title, explanation, kind: 'code', references }
+}
`,
  'src/main/guide-source.ts': `diff --git a/src/main/guide-source.ts b/src/main/guide-source.ts
new file mode 100644
index 0000000..2222222
--- /dev/null
+++ b/src/main/guide-source.ts
@@ -0,0 +1,5 @@
+export class GuideToolHost {
+  async emitSection(raw: unknown): Promise<RenderableSection> {
+    const section = parseEmitSection(raw) // trust boundary
+  }
+}
`,
  'src/shared/split-patch.ts': `export interface FilePatch {
  path: string
  patch: string
}

// Split a raw unified diff into one slice per file, keyed by the new path
// from its \`diff --git\` header — needed on both sides of the IPC seam.
export function splitPatchByFile(rawPatch: string): FilePatch[] {
  if (!rawPatch.trim()) return []
  // walk 'diff --git' boundaries...
}
`,
  'src/renderer/src/GuideView.tsx': `// The Guide tab: renders Sections as they stream in over IPC. Each Section
// is tight prose beside its Code References — changed refs as a diff, unchanged
// context as full file text. Basic static layout; scrollytelling lands later.
export function GuideView({ target }: { target: PrTarget }) {
  const sections = useStreamingGuide(target)
  return <>{sections.map(s => <SectionCard key={s.ordinal} section={s} />)}</>
}
`
}

async function cannedResolver(ref: CodeReference): Promise<string> {
  return CANNED_CONTENT[ref.path] ?? `// (no canned content for ${ref.path})`
}

/**
 * Hand-written emit_section payloads. Section 1 ties two files into one idea
 * (multi-reference), mixing a diff and a full-context reference.
 */
const STUB_SECTION_PAYLOADS: unknown[] = [
  {
    ordinal: 1,
    title: 'The Agent → app trust boundary',
    explanation:
      'The Guide is produced by an autonomous **Agent**, so every `emit_section` payload is validated at the boundary before the app trusts it. `GuideSchema` owns those validators; the generation seam resolves each reference to displayable content.',
    kind: 'code',
    references: [
      {
        path: 'src/shared/guide-schema.ts',
        lineRange: { start: 90, end: 120 },
        renderMode: 'diff',
        kind: 'code'
      },
      {
        path: 'src/main/guide-source.ts',
        lineRange: { start: 60, end: 75 },
        renderMode: 'diff',
        kind: 'code'
      }
    ]
  },
  {
    ordinal: 2,
    title: 'Splitting a patch is shared context',
    explanation:
      'A Section can point at **unchanged** code that a reader needs for context. Here is the existing patch-splitter, rendered in full — nothing changed, but it explains how one diff becomes per-file slices on both sides of the IPC seam.',
    kind: 'code',
    references: [
      {
        path: 'src/shared/split-patch.ts',
        lineRange: { start: 1, end: 33 },
        renderMode: 'full',
        kind: 'code'
      }
    ]
  },
  {
    ordinal: 3,
    title: 'Streaming Sections into the Guide tab',
    explanation:
      'Sections stream to the renderer as the Agent emits them, so the reviewer can start reading Section 1 while the rest is still being produced.',
    kind: 'code',
    references: [
      {
        path: 'src/renderer/src/GuideView.tsx',
        lineRange: { start: 1, end: 8 },
        renderMode: 'full',
        kind: 'code'
      }
    ]
  }
]

/** Canned coverage: the stub narrated the schema hunk, left one hunk un-narrated. */
const STUB_FINALIZE_PAYLOAD: unknown = {
  narrated: [{ path: 'src/shared/guide-schema.ts', lineRange: { start: 90, end: 120 } }],
  omitted: [{ path: 'src/main/ipc.ts', lineRange: { start: 76, end: 96 } }]
}
