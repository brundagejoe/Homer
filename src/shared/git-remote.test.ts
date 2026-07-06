import { describe, expect, it } from 'bun:test'
import { parseOwnerRepo } from './git-remote'

describe('parseOwnerRepo', () => {
  it('parses an SCP-style ssh remote (git@github.com:owner/repo.git)', () => {
    expect(parseOwnerRepo('git@github.com:acme/widgets.git')).toEqual({
      owner: 'acme',
      repo: 'widgets'
    })
  })

  it('parses an SCP-style ssh remote without the .git suffix', () => {
    expect(parseOwnerRepo('git@github.com:acme/widgets')).toEqual({
      owner: 'acme',
      repo: 'widgets'
    })
  })

  it('parses an https remote with a .git suffix', () => {
    expect(parseOwnerRepo('https://github.com/acme/widgets.git')).toEqual({
      owner: 'acme',
      repo: 'widgets'
    })
  })

  it('parses an https remote without a .git suffix', () => {
    expect(parseOwnerRepo('https://github.com/acme/widgets')).toEqual({
      owner: 'acme',
      repo: 'widgets'
    })
  })

  it('parses an ssh:// URL remote', () => {
    expect(parseOwnerRepo('ssh://git@github.com/acme/widgets.git')).toEqual({
      owner: 'acme',
      repo: 'widgets'
    })
  })

  it('parses an https remote with an embedded token', () => {
    expect(parseOwnerRepo('https://x-access-token:ghs_abc@github.com/acme/widgets.git')).toEqual({
      owner: 'acme',
      repo: 'widgets'
    })
  })

  it('is case-insensitive on the host', () => {
    expect(parseOwnerRepo('git@GitHub.com:acme/widgets.git')).toEqual({
      owner: 'acme',
      repo: 'widgets'
    })
    expect(parseOwnerRepo('https://GITHUB.COM/acme/widgets')).toEqual({
      owner: 'acme',
      repo: 'widgets'
    })
  })

  it('preserves owner/repo case (GitHub slugs are case-insensitive but we keep the original)', () => {
    expect(parseOwnerRepo('git@github.com:Acme/Widgets.git')).toEqual({
      owner: 'Acme',
      repo: 'Widgets'
    })
  })

  it('tolerates surrounding whitespace and a trailing slash', () => {
    expect(parseOwnerRepo('  https://github.com/acme/widgets/  ')).toEqual({
      owner: 'acme',
      repo: 'widgets'
    })
  })

  it('accepts GitHub SSH host aliases (github.com-<alias> / github.com.<alias>)', () => {
    expect(parseOwnerRepo('git@github.com-work:acme/widgets.git')).toEqual({
      owner: 'acme',
      repo: 'widgets'
    })
    expect(parseOwnerRepo('git@github.com.personal:acme/widgets.git')).toEqual({
      owner: 'acme',
      repo: 'widgets'
    })
    expect(parseOwnerRepo('ssh://git@github.com-work/acme/widgets.git')).toEqual({
      owner: 'acme',
      repo: 'widgets'
    })
  })

  it('returns null for a non-GitHub host', () => {
    expect(parseOwnerRepo('git@gitlab.com:acme/widgets.git')).toBeNull()
    expect(parseOwnerRepo('https://bitbucket.org/acme/widgets.git')).toBeNull()
  })

  it('returns null for a foreign host that merely starts with "github.com"', () => {
    expect(parseOwnerRepo('git@github.computer.com:acme/widgets.git')).toBeNull()
    expect(parseOwnerRepo('https://github.com.evil.example/acme/widgets.git')).toBeNull()
  })

  it('returns null for garbage / non-remote strings', () => {
    expect(parseOwnerRepo('')).toBeNull()
    expect(parseOwnerRepo('not a url')).toBeNull()
    expect(parseOwnerRepo('https://github.com/acme')).toBeNull()
    expect(parseOwnerRepo('https://github.com/')).toBeNull()
    expect(parseOwnerRepo('github.com')).toBeNull()
  })
})
