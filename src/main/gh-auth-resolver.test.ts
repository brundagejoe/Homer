import { describe, test, expect } from 'bun:test'
import { GhAuthResolver, RunCommand } from './gh-auth-resolver'

function withRunner(runner: RunCommand) {
  return new GhAuthResolver(runner)
}

describe('GhAuthResolver.status', () => {
  test('reports gh-not-installed when the gh command is not found', async () => {
    const resolver = withRunner(async () => {
      throw Object.assign(new Error('not found'), { code: 'ENOENT' })
    })
    const status = await resolver.status()
    expect(status.kind).toBe('gh-not-installed')
  })

  test('parses authenticated output with the username', async () => {
    const resolver = withRunner(async () => ({
      stdout: '',
      stderr: [
        'github.com',
        '  ✓ Logged in to github.com account brundagejoe (GITHUB_TOKEN)',
        '  - Active account: true',
        '  - Git operations protocol: https',
        ''
      ].join('\n'),
      code: 0
    }))
    const status = await resolver.status()
    expect(status).toEqual({ kind: 'authenticated', user: 'brundagejoe' })
  })

  test('reports not-authenticated when gh exits non-zero with login prompt', async () => {
    const resolver = withRunner(async () => ({
      stdout: '',
      stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n',
      code: 1
    }))
    const status = await resolver.status()
    expect(status.kind).toBe('not-authenticated')
  })
})

describe('GhAuthResolver.token', () => {
  test('returns the token string when gh auth token succeeds', async () => {
    const resolver = withRunner(async args => {
      expect(args).toEqual(['auth', 'token'])
      return { stdout: 'ghp_secret123\n', stderr: '', code: 0 }
    })
    const token = await resolver.token()
    expect(token).toBe('ghp_secret123')
  })

  test('returns null when gh auth token fails (not authenticated)', async () => {
    const resolver = withRunner(async () => ({
      stdout: '',
      stderr: 'no oauth token\n',
      code: 1
    }))
    const token = await resolver.token()
    expect(token).toBeNull()
  })

  test('returns null when gh is not installed', async () => {
    const resolver = withRunner(async () => {
      throw Object.assign(new Error('not found'), { code: 'ENOENT' })
    })
    const token = await resolver.token()
    expect(token).toBeNull()
  })
})
