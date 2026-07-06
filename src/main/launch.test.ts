import { describe, expect, it } from 'bun:test'
import { buildLaunchArgs, parsePrFlag, resolveLaunchTarget } from './launch'

const ELECTRON = '/path/to/electron'
const APP = '/path/to/app'

describe('resolveLaunchTarget', () => {
  it('resolves a GitHub PR URL passed on the command line', () => {
    const argv = [ELECTRON, APP, 'https://github.com/acme/widgets/pull/42']
    expect(resolveLaunchTarget(argv)).toEqual({ owner: 'acme', repo: 'widgets', number: 42 })
  })

  it('returns null when no PR URL is present', () => {
    expect(resolveLaunchTarget([ELECTRON, APP])).toBeNull()
    expect(resolveLaunchTarget([ELECTRON, APP, '/some/local/path'])).toBeNull()
  })

  it('ignores flags and the app path when scanning for a URL', () => {
    const argv = [ELECTRON, APP, '--some-flag', '/path/to/app.asar', 'https://github.com/o/r/pull/7']
    expect(resolveLaunchTarget(argv)).toEqual({ owner: 'o', repo: 'r', number: 7 })
  })
})

describe('buildLaunchArgs / parsePrFlag', () => {
  it('round-trips a PR target through renderer launch args', () => {
    const target = { owner: 'acme', repo: 'widgets', number: 42 }
    const args = buildLaunchArgs(target)
    expect(parsePrFlag(args)).toEqual(target)
  })

  it('builds no args and parses to null when there is no target', () => {
    expect(buildLaunchArgs(null)).toEqual([])
    expect(parsePrFlag([ELECTRON, APP])).toBeNull()
  })
})
