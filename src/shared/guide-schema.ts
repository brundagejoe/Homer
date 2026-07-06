/**
 * GuideSchema — the shared, pure contract for the Guide the Agent produces.
 *
 * It owns two things and nothing else:
 *  1. the data shapes (`Section`, `CodeReference`, `Guide`, `CoverageMap`), and
 *  2. the trust boundary between the Agent and the app: strict validators for
 *     the `emit_section` / `finalize_guide` tool calls that parse well-formed
 *     payloads into typed values and reject malformed ones with useful errors.
 *
 * It has no knowledge of subprocesses, IPC, git, or rendering — those live in
 * the generation seam and the renderer. Prior-art style: `split-patch.ts`.
 */

/** Discriminator for future Section renderers; V1 registers only `code`. */
export type SectionKind = 'code'

/** How a Code Reference should be shown: changed lines as a diff, or full file. */
export type RenderMode = 'diff' | 'full'

/** Discriminator for future reference kinds; V1 registers only `code`. */
export type ReferenceKind = 'code'

/** An inclusive 1-based line span within a file. */
export interface LineRange {
  start: number
  end: number
}

/**
 * A pointer from a Section into the code. May point at changed OR unchanged
 * code. Many-to-many with Sections — the Guide is a narrative overlay, not a
 * partition of the diff.
 */
export interface CodeReference {
  path: string
  lineRange: LineRange
  renderMode: RenderMode
  kind: ReferenceKind
}

/** One step of the Guide: tight prose plus 1..N Code References. */
export interface Section {
  ordinal: number
  title: string
  /** Markdown, kept tight. */
  explanation: string
  references: CodeReference[]
  kind: SectionKind
}

/** The Guide: an ordered sequence of Sections. */
export interface Guide {
  sections: Section[]
}

/** A changed hunk the Agent declares as narrated or omitted at finalize time. */
export interface HunkRef {
  path: string
  lineRange: LineRange
}

/**
 * Declared by the Agent at `finalize_guide`: which changed hunks the Guide
 * narrated vs. left out. Powers the Diff view's flagging of un-narrated
 * changes (reconciliation itself is CoverageMapper, slice #30).
 */
export interface CoverageMap {
  narrated: HunkRef[]
  omitted: HunkRef[]
}

/** Raised when a tool-call payload violates the contract. */
export class GuideContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuideContractError'
  }
}

/**
 * Validate a raw `emit_section` payload (as it arrives from the Agent across
 * the trust boundary) and return a typed Section. Throws `GuideContractError`
 * with a field-pointed message on the first violation.
 */
export function parseEmitSection(raw: unknown): Section {
  const obj = asObject(raw, 'emit_section')

  const ordinal = obj.ordinal
  if (!isPositiveInt(ordinal)) {
    fail(`emit_section: "ordinal" must be a positive integer (got ${describe(ordinal)})`)
  }

  const title = obj.title
  if (!isNonEmptyString(title)) {
    fail(`emit_section: "title" must be a non-empty string (got ${describe(title)})`)
  }

  const explanation = obj.explanation
  if (!isNonEmptyString(explanation)) {
    fail(`emit_section: "explanation" must be a non-empty string (got ${describe(explanation)})`)
  }

  if (obj.kind !== 'code') {
    fail(`emit_section: "kind" must be "code" (got ${describe(obj.kind)})`)
  }

  if (!Array.isArray(obj.references)) {
    fail(`emit_section: "references" must be an array (got ${describe(obj.references)})`)
  }
  const rawRefs = obj.references as unknown[]
  if (rawRefs.length === 0) {
    fail('emit_section: "references" must contain at least one reference')
  }
  const references = rawRefs.map((r, i) => parseReference(r, i))

  return {
    ordinal: ordinal as number,
    title: title as string,
    explanation: explanation as string,
    kind: 'code',
    references
  }
}

/**
 * Validate a raw `finalize_guide` payload and return its CoverageMap. Throws
 * `GuideContractError` with a field-pointed message on the first violation.
 */
export function parseFinalizeGuide(raw: unknown): CoverageMap {
  const obj = asObject(raw, 'finalize_guide')
  return {
    narrated: parseHunkList(obj.narrated, 'narrated'),
    omitted: parseHunkList(obj.omitted, 'omitted')
  }
}

function parseReference(raw: unknown, i: number): CodeReference {
  const at = `reference[${i}]`
  const obj = asObject(raw, `emit_section: ${at}`)

  if (!isNonEmptyString(obj.path)) {
    fail(`emit_section: ${at}.path must be a non-empty string (got ${describe(obj.path)})`)
  }
  if (obj.renderMode !== 'diff' && obj.renderMode !== 'full') {
    fail(`emit_section: ${at}.renderMode must be "diff" or "full" (got ${describe(obj.renderMode)})`)
  }
  if (obj.kind !== 'code') {
    fail(`emit_section: ${at}.kind must be "code" (got ${describe(obj.kind)})`)
  }

  return {
    path: obj.path as string,
    lineRange: parseLineRange(obj.lineRange, `emit_section: ${at}.lineRange`),
    renderMode: obj.renderMode,
    kind: 'code'
  }
}

function parseHunkList(raw: unknown, field: 'narrated' | 'omitted'): HunkRef[] {
  if (!Array.isArray(raw)) {
    fail(`finalize_guide: "${field}" must be an array (got ${describe(raw)})`)
  }
  return (raw as unknown[]).map((h, i) => {
    const at = `finalize_guide: ${field}[${i}]`
    const obj = asObject(h, at)
    if (!isNonEmptyString(obj.path)) {
      fail(`${at}.path must be a non-empty string (got ${describe(obj.path)})`)
    }
    return { path: obj.path as string, lineRange: parseLineRange(obj.lineRange, `${at}.lineRange`) }
  })
}

function parseLineRange(raw: unknown, at: string): LineRange {
  const obj = asObject(raw, at)
  if (!isPositiveInt(obj.start)) {
    fail(`${at}.start must be a positive integer (got ${describe(obj.start)})`)
  }
  if (!isPositiveInt(obj.end)) {
    fail(`${at}.end must be a positive integer (got ${describe(obj.end)})`)
  }
  if ((obj.start as number) > (obj.end as number)) {
    fail(`${at}.start (${obj.start}) must be <= end (${obj.end})`)
  }
  return { start: obj.start as number, end: obj.end as number }
}

function asObject(raw: unknown, at: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(`${at}: expected an object (got ${describe(raw)})`)
  }
  return raw as Record<string, unknown>
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/** A short, safe description of an unexpected value for error messages. */
function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'string') return v.length > 40 ? `"${v.slice(0, 40)}…"` : `"${v}"`
  return typeof v === 'object' ? 'object' : String(v)
}

function fail(message: string): never {
  throw new GuideContractError(message)
}
