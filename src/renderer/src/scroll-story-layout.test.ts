import { describe, test, expect } from 'bun:test'
import { choosePinSide, resolveActiveOrdinal, formatProgress } from './scroll-story-layout'

describe('choosePinSide', () => {
  test('pins the prose column when prose is the shorter column', () => {
    expect(choosePinSide({ proseHeight: 120, codeHeight: 800 })).toBe('prose')
  })

  test('pins the code column when code is the shorter column', () => {
    expect(choosePinSide({ proseHeight: 900, codeHeight: 200 })).toBe('code')
  })

  test('pins the prose column on a tie (narrative stays put by default)', () => {
    expect(choosePinSide({ proseHeight: 400, codeHeight: 400 })).toBe('prose')
  })
})

describe('resolveActiveOrdinal', () => {
  test('returns the crossing section when exactly one is on the line', () => {
    expect(resolveActiveOrdinal([3], 1)).toBe(3)
  })

  test('advances to the furthest-down section when a boundary momentarily overlaps', () => {
    expect(resolveActiveOrdinal([2, 3], 2)).toBe(3)
  })

  test('holds the previous section when the line is in a gap (nothing intersecting)', () => {
    expect(resolveActiveOrdinal([], 4)).toBe(4)
  })

  test('works crossing a boundary in either direction (set is order-independent)', () => {
    expect(resolveActiveOrdinal(new Set([5, 4]), 5)).toBe(5)
  })
})

describe('formatProgress', () => {
  test('renders a zero-padded NN / NN indicator', () => {
    expect(formatProgress(2, 5)).toBe('02 / 05')
  })

  test('pads into double digits without truncating three-digit totals', () => {
    expect(formatProgress(10, 12)).toBe('10 / 12')
  })

  test('never emits a negative numerator before the first crossing', () => {
    expect(formatProgress(0, 3)).toBe('00 / 03')
  })
})
