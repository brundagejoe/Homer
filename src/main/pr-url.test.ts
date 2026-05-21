import { describe, test, expect } from 'bun:test'
import { parsePrUrl } from './pr-url'

describe('parsePrUrl', () => {
  test('parses a basic PR URL', () => {
    expect(parsePrUrl('https://github.com/acme/widgets/pull/42')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 42
    })
  })

  test('parses a PR URL with trailing files segment', () => {
    expect(parsePrUrl('https://github.com/acme/widgets/pull/42/files')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 42
    })
  })

  test('parses a PR URL with a query string', () => {
    expect(parsePrUrl('https://github.com/acme/widgets/pull/42?w=1')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 42
    })
  })

  test('trims surrounding whitespace', () => {
    expect(parsePrUrl('   https://github.com/acme/widgets/pull/42  ')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 42
    })
  })

  test('returns null for a non-PR github URL', () => {
    expect(parsePrUrl('https://github.com/acme/widgets/issues/42')).toBeNull()
  })

  test('returns null for an empty string', () => {
    expect(parsePrUrl('')).toBeNull()
  })

  test('returns null for a non-github host', () => {
    expect(parsePrUrl('https://gitlab.com/acme/widgets/pull/42')).toBeNull()
  })
})
