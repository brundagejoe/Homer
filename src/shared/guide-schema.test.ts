import { describe, test, expect } from 'bun:test'
import { parseEmitSection, parseFinalizeGuide } from './guide-schema'

const WELL_FORMED_SECTION = {
  ordinal: 1,
  title: 'Split the patch by file',
  explanation: 'The parser walks `diff --git` boundaries to slice one patch per file.',
  kind: 'code',
  references: [
    { path: 'src/shared/split-patch.ts', lineRange: { start: 16, end: 33 }, renderMode: 'full', kind: 'code' }
  ]
}

describe('parseEmitSection', () => {
  test('parses a well-formed emit_section payload into a Section', () => {
    const section = parseEmitSection(WELL_FORMED_SECTION)
    expect(section.ordinal).toBe(1)
    expect(section.title).toBe('Split the patch by file')
    expect(section.kind).toBe('code')
    expect(section.references).toHaveLength(1)
    expect(section.references[0].path).toBe('src/shared/split-patch.ts')
    expect(section.references[0].renderMode).toBe('full')
    expect(section.references[0].lineRange).toEqual({ start: 16, end: 33 })
  })

  test('parses a section that ties multiple files together into one idea', () => {
    const section = parseEmitSection({
      ...WELL_FORMED_SECTION,
      references: [
        { path: 'src/a.ts', lineRange: { start: 1, end: 5 }, renderMode: 'diff', kind: 'code' },
        { path: 'src/a.test.ts', lineRange: { start: 10, end: 20 }, renderMode: 'full', kind: 'code' }
      ]
    })
    expect(section.references.map(r => r.path)).toEqual(['src/a.ts', 'src/a.test.ts'])
    expect(section.references.map(r => r.renderMode)).toEqual(['diff', 'full'])
  })

  test('rejects a section with no references, naming the field', () => {
    expect(() => parseEmitSection({ ...WELL_FORMED_SECTION, references: [] })).toThrow(
      /references.*at least one/i
    )
  })

  test('rejects a missing references array with a useful error', () => {
    const { references: _drop, ...noRefs } = WELL_FORMED_SECTION
    expect(() => parseEmitSection(noRefs)).toThrow(/"references" must be an array/)
  })

  test('rejects a non-positive ordinal, naming the field', () => {
    expect(() => parseEmitSection({ ...WELL_FORMED_SECTION, ordinal: 0 })).toThrow(/"ordinal"/)
  })

  test('rejects an empty title, naming the field', () => {
    expect(() => parseEmitSection({ ...WELL_FORMED_SECTION, title: '  ' })).toThrow(/"title"/)
  })

  test('rejects an unknown section kind (discriminator is "code" only in V1)', () => {
    expect(() => parseEmitSection({ ...WELL_FORMED_SECTION, kind: 'diagram' })).toThrow(/"kind".*code/)
  })

  test('rejects a reference with an invalid renderMode, pointing at the reference index', () => {
    expect(() =>
      parseEmitSection({
        ...WELL_FORMED_SECTION,
        references: [{ path: 'a.ts', lineRange: { start: 1, end: 2 }, renderMode: 'inline', kind: 'code' }]
      })
    ).toThrow(/reference\[0\]\.renderMode/)
  })

  test('rejects a reference whose lineRange is inverted (start > end)', () => {
    expect(() =>
      parseEmitSection({
        ...WELL_FORMED_SECTION,
        references: [{ path: 'a.ts', lineRange: { start: 9, end: 2 }, renderMode: 'full', kind: 'code' }]
      })
    ).toThrow(/reference\[0\]\.lineRange\.start.*<=.*end/)
  })

  test('rejects a non-object payload', () => {
    expect(() => parseEmitSection(null)).toThrow(/expected an object/)
    expect(() => parseEmitSection('nope')).toThrow(/expected an object/)
  })
})

describe('parseFinalizeGuide', () => {
  test('parses a well-formed coverage map', () => {
    const coverage = parseFinalizeGuide({
      narrated: [{ path: 'src/a.ts', lineRange: { start: 1, end: 5 } }],
      omitted: [{ path: 'src/b.ts', lineRange: { start: 3, end: 3 } }]
    })
    expect(coverage.narrated).toEqual([{ path: 'src/a.ts', lineRange: { start: 1, end: 5 } }])
    expect(coverage.omitted).toEqual([{ path: 'src/b.ts', lineRange: { start: 3, end: 3 } }])
  })

  test('accepts empty narrated/omitted lists (a Guide that narrated nothing)', () => {
    expect(parseFinalizeGuide({ narrated: [], omitted: [] })).toEqual({ narrated: [], omitted: [] })
  })

  test('rejects a coverage list that is not an array, naming the field', () => {
    expect(() => parseFinalizeGuide({ narrated: 'all', omitted: [] })).toThrow(
      /"narrated" must be an array/
    )
  })

  test('rejects a hunk with a bad lineRange, pointing at the list index', () => {
    expect(() =>
      parseFinalizeGuide({ narrated: [{ path: 'a.ts', lineRange: { start: 0, end: 2 } }], omitted: [] })
    ).toThrow(/narrated\[0\]\.lineRange\.start/)
  })
})
