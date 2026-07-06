import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import {
  discoverRepo,
  isGitRepo,
  repoMatchesTarget,
  resolveRepoForTarget,
  RepoNotFoundError
} from './repo-discovery'

function git(repo: string, args: string): void {
  execSync(`git ${args}`, { cwd: repo, encoding: 'utf8' })
}

/**
 * Create a directory that is a git repo with the given remotes. Pass either a
 * single `origin` URL or a map of `{ remoteName: url }`.
 */
function makeClone(parent: string, name: string, remotes: string | Record<string, string>): string {
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init -q -b main')
  const map = typeof remotes === 'string' ? { origin: remotes } : remotes
  for (const [remote, url] of Object.entries(map)) {
    git(dir, `remote add ${remote} ${url}`)
  }
  return dir
}

/** A git repo with no remotes configured. */
function makeRemoteless(parent: string, name: string): string {
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init -q -b main')
  return dir
}

/** A plain (non-git) directory. */
function makePlainDir(parent: string, name: string): string {
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'file.txt'), 'not a repo\n')
  return dir
}

describe('repo discovery', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dv-discovery-root-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  describe('repoMatchesTarget', () => {
    test('true when the clone origin matches the target owner/repo', async () => {
      const dir = makeClone(root, 'widgets', 'git@github.com:acme/widgets.git')
      expect(await repoMatchesTarget(dir, { owner: 'acme', repo: 'widgets' })).toBe(true)
    })

    test('matches case-insensitively', async () => {
      const dir = makeClone(root, 'widgets', 'https://github.com/Acme/Widgets.git')
      expect(await repoMatchesTarget(dir, { owner: 'acme', repo: 'widgets' })).toBe(true)
    })

    test('false when the origin points at a different repo', async () => {
      const dir = makeClone(root, 'widgets', 'git@github.com:acme/gadgets.git')
      expect(await repoMatchesTarget(dir, { owner: 'acme', repo: 'widgets' })).toBe(false)
    })

    test('false for a directory that is not a git repo', async () => {
      const dir = makePlainDir(root, 'plain')
      expect(await repoMatchesTarget(dir, { owner: 'acme', repo: 'widgets' })).toBe(false)
    })

    test('true when a NON-origin remote (upstream) matches — fork workflow', async () => {
      // origin is the reviewer's fork; upstream is the canonical repo the PR targets.
      const dir = makeClone(root, 'widgets', {
        origin: 'git@github.com:me/widgets.git',
        upstream: 'git@github.com:acme/widgets.git'
      })
      expect(await repoMatchesTarget(dir, { owner: 'acme', repo: 'widgets' })).toBe(true)
    })

    test('true when the origin is an SSH host alias', async () => {
      const dir = makeClone(root, 'widgets', 'git@github.com-work:acme/widgets.git')
      expect(await repoMatchesTarget(dir, { owner: 'acme', repo: 'widgets' })).toBe(true)
    })
  })

  describe('isGitRepo', () => {
    test('true for a git repo (even with no remotes)', async () => {
      expect(await isGitRepo(makeRemoteless(root, 'bare'))).toBe(true)
    })

    test('false for a plain directory', async () => {
      expect(await isGitRepo(makePlainDir(root, 'plain'))).toBe(false)
    })
  })

  describe('discoverRepo', () => {
    test('finds the clone under a root whose origin matches', async () => {
      const dir = makeClone(root, 'widgets', 'git@github.com:acme/widgets.git')
      makeClone(root, 'other', 'git@github.com:acme/other.git')

      const found = await discoverRepo({ owner: 'acme', repo: 'widgets', roots: [root] })
      expect(found).toBe(dir)
    })

    test('finds a clone that matches via a non-origin remote (fork upstream)', async () => {
      const dir = makeClone(root, 'my-widgets', {
        origin: 'git@github.com:me/widgets.git',
        upstream: 'git@github.com:acme/widgets.git'
      })
      makeClone(root, 'other', 'git@github.com:acme/other.git')

      const found = await discoverRepo({ owner: 'acme', repo: 'widgets', roots: [root] })
      expect(found).toBe(dir)
    })

    test('returns null when no clone under the roots matches', async () => {
      makeClone(root, 'other', 'git@github.com:acme/other.git')
      makePlainDir(root, 'notes')

      const found = await discoverRepo({ owner: 'acme', repo: 'widgets', roots: [root] })
      expect(found).toBeNull()
    })

    test('prefers the clone whose directory name matches the repo when several match', async () => {
      // Two local clones of the same GitHub repo, in differently-named folders.
      makeClone(root, 'widgets-fork', 'git@github.com:acme/widgets.git')
      const exact = makeClone(root, 'widgets', 'https://github.com/acme/widgets.git')

      const found = await discoverRepo({ owner: 'acme', repo: 'widgets', roots: [root] })
      expect(found).toBe(exact)
    })

    test('skips non-repo dirs, node_modules and dotdirs without throwing', async () => {
      makePlainDir(root, 'plain')
      // A node_modules tree that (pathologically) contains a matching clone must
      // be skipped — we never walk into it.
      makeClone(join(root, 'node_modules'), 'widgets', 'git@github.com:acme/widgets.git')
      makeClone(join(root, '.cache'), 'widgets', 'git@github.com:acme/widgets.git')
      const real = makeClone(root, 'widgets', 'git@github.com:acme/widgets.git')

      const found = await discoverRepo({ owner: 'acme', repo: 'widgets', roots: [root] })
      expect(found).toBe(real)
    })

    test('finds a clone nested one level below a root (bounded depth)', async () => {
      const org = join(root, 'work')
      mkdirSync(org, { recursive: true })
      const dir = makeClone(org, 'widgets', 'git@github.com:acme/widgets.git')

      const found = await discoverRepo({ owner: 'acme', repo: 'widgets', roots: [root] })
      expect(found).toBe(dir)
    })

    test('searches across multiple roots', async () => {
      const rootB = mkdtempSync(join(tmpdir(), 'dv-discovery-rootb-'))
      try {
        makeClone(root, 'other', 'git@github.com:acme/other.git')
        const dir = makeClone(rootB, 'widgets', 'git@github.com:acme/widgets.git')

        const found = await discoverRepo({ owner: 'acme', repo: 'widgets', roots: [root, rootB] })
        expect(found).toBe(dir)
      } finally {
        rmSync(rootB, { recursive: true, force: true })
      }
    })

    test('returns null (does not throw) for a root that does not exist', async () => {
      const found = await discoverRepo({
        owner: 'acme',
        repo: 'widgets',
        roots: [join(root, 'nope')]
      })
      expect(found).toBeNull()
    })

    test('returns null when no roots are configured', async () => {
      expect(await discoverRepo({ owner: 'acme', repo: 'widgets', roots: [] })).toBeNull()
    })
  })

  describe('resolveRepoForTarget', () => {
    const target = { owner: 'acme', repo: 'widgets' }

    test('uses the launch context when its remote verifies against the PR', async () => {
      const launch = makeClone(root, 'widgets', 'git@github.com:acme/widgets.git')
      const resolved = await resolveRepoForTarget({ target, launchContext: launch, roots: [] })
      expect(resolved).toBe(launch)
    })

    test('discovers a clone under the roots when the launch context does not match', async () => {
      const launch = makeClone(root, 'unrelated', 'git@github.com:acme/gadgets.git')
      const codeRoot = mkdtempSync(join(tmpdir(), 'dv-resolve-root-'))
      try {
        const real = makeClone(codeRoot, 'widgets', 'git@github.com:acme/widgets.git')
        const resolved = await resolveRepoForTarget({
          target,
          launchContext: launch,
          roots: [codeRoot]
        })
        expect(resolved).toBe(real)
      } finally {
        rmSync(codeRoot, { recursive: true, force: true })
      }
    })

    test('a verified discovery match beats an unverified launch-context repo', async () => {
      // Launch context is a git repo whose remote we can't classify (non-GitHub),
      // but a configured root holds the real, verifiable clone — discovery wins.
      const launch = makeClone(root, 'mystery', 'git@example.com:acme/widgets.git')
      const codeRoot = mkdtempSync(join(tmpdir(), 'dv-resolve-root-'))
      try {
        const real = makeClone(codeRoot, 'widgets', 'git@github.com:acme/widgets.git')
        const resolved = await resolveRepoForTarget({
          target,
          launchContext: launch,
          roots: [codeRoot]
        })
        expect(resolved).toBe(real)
      } finally {
        rmSync(codeRoot, { recursive: true, force: true })
      }
    })

    test('falls back to the launch-context repo when its remote cannot be verified and discovery finds nothing', async () => {
      // e.g. a private/GHE host or an unrecognized SSH alias — the user did launch
      // from the repo, so use it rather than erroring.
      const launch = makeClone(root, 'internal', 'git@ghe.corp.example:acme/widgets.git')
      const resolved = await resolveRepoForTarget({ target, launchContext: launch, roots: [] })
      expect(resolved).toBe(launch)
    })

    test('falls back to a remoteless launch-context repo (dev flow with no origin)', async () => {
      const launch = makeRemoteless(root, 'local-only')
      const resolved = await resolveRepoForTarget({ target, launchContext: launch, roots: [] })
      expect(resolved).toBe(launch)
    })

    test('throws RepoNotFoundError when the launch context is not a git repo and nothing is discovered', async () => {
      const launch = makePlainDir(root, 'not-a-repo')
      await expect(
        resolveRepoForTarget({ target, launchContext: launch, roots: [] })
      ).rejects.toBeInstanceOf(RepoNotFoundError)
    })

    test('RepoNotFoundError reports whether roots were configured', async () => {
      const noRoots = await resolveRepoForTarget({
        target,
        launchContext: null,
        roots: []
      }).catch(e => e as RepoNotFoundError)
      expect(noRoots).toBeInstanceOf(RepoNotFoundError)
      expect((noRoots as RepoNotFoundError).hasRoots).toBe(false)

      const emptyRoot = mkdtempSync(join(tmpdir(), 'dv-resolve-empty-'))
      try {
        const withRoots = await resolveRepoForTarget({
          target,
          launchContext: null,
          roots: [emptyRoot]
        }).catch(e => e as RepoNotFoundError)
        expect((withRoots as RepoNotFoundError).hasRoots).toBe(true)
      } finally {
        rmSync(emptyRoot, { recursive: true, force: true })
      }
    })
  })
})
