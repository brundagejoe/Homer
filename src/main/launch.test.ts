import { describe, expect, it } from 'bun:test'
import { buildLaunchArgs, parsePrFlag, resolveLaunchTarget, resolveRepoPath } from './launch'

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

describe('resolveRepoPath', () => {
  const CWD = '/Users/me/project'

  it('prefers the --repo= launch flag (global install: cwd is /, so the shim passes $PWD)', () => {
    const argv = [ELECTRON, APP, '--repo=/Users/me/other-repo', 'https://github.com/o/r/pull/1']
    expect(resolveRepoPath(argv, {}, '/')).toBe('/Users/me/other-repo')
  })

  it('round-trips a repo path passed by the shim as --repo=$PWD', () => {
    const repo = '/Users/me/some repo/with spaces'
    expect(resolveRepoPath([ELECTRON, APP, `--repo=${repo}`], {}, '/')).toBe(repo)
  })

  it('falls back to DV_REPO when no flag is present', () => {
    expect(resolveRepoPath([ELECTRON, APP], { DV_REPO: '/env/repo' }, CWD)).toBe('/env/repo')
  })

  it('falls back to the launch cwd (in-repo dev flow) when neither flag nor env is set', () => {
    expect(resolveRepoPath([ELECTRON, APP], {}, CWD)).toBe(CWD)
  })

  it('ignores an empty --repo= value and falls through to the next source', () => {
    expect(resolveRepoPath([ELECTRON, APP, '--repo='], { DV_REPO: '/env/repo' }, CWD)).toBe('/env/repo')
    expect(resolveRepoPath([ELECTRON, APP, '--repo='], {}, CWD)).toBe(CWD)
  })

  it('lets the flag win over DV_REPO', () => {
    const argv = [ELECTRON, APP, '--repo=/flag/repo']
    expect(resolveRepoPath(argv, { DV_REPO: '/env/repo' }, CWD)).toBe('/flag/repo')
  })
})
