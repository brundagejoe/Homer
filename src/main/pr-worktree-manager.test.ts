import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { PrWorktreeManager } from './pr-worktree-manager'

function git(repo: string, args: string): string {
  return execSync(`git ${args}`, { cwd: repo, encoding: 'utf8' }).trim()
}

/** Init a throwaway repo and return its path. */
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dv-wt-repo-'))
  git(dir, 'init -q -b main')
  git(dir, 'config user.email test@example.com')
  git(dir, 'config user.name Test')
  git(dir, 'config commit.gpgsign false')
  return dir
}

/** Write a file, commit it, and return the resulting commit SHA. */
function commit(repo: string, file: string, content: string, message: string): string {
  writeFileSync(join(repo, file), content)
  git(repo, 'add .')
  git(repo, `commit -q -m ${message}`)
  return git(repo, 'rev-parse HEAD')
}

describe('PrWorktreeManager', () => {
  let repo: string
  let cacheDir: string

  beforeEach(() => {
    repo = initRepo()
    cacheDir = mkdtempSync(join(tmpdir(), 'dv-wt-cache-'))
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
    rmSync(cacheDir, { recursive: true, force: true })
  })

  test('acquire materializes a worktree at the requested SHA without touching the user working tree', async () => {
    const sha1 = commit(repo, 'file.txt', 'version one\n', 'v1')
    const sha2 = commit(repo, 'file.txt', 'version two\n', 'v2')

    const mgr = new PrWorktreeManager({ cacheDir })
    const path = await mgr.acquire(repo, sha1)

    // Worktree exists, lives outside the user's repo, and has the file as of sha1.
    expect(existsSync(path)).toBe(true)
    expect(path.startsWith(cacheDir)).toBe(true)
    expect(path.startsWith(repo)).toBe(false)
    expect(readFileSync(join(path, 'file.txt'), 'utf8')).toBe('version one\n')

    // The user's own working tree/HEAD is untouched (still at sha2, clean).
    expect(git(repo, 'rev-parse HEAD')).toBe(sha2)
    expect(readFileSync(join(repo, 'file.txt'), 'utf8')).toBe('version two\n')
    expect(git(repo, 'status --porcelain')).toBe('')
  })

  test('release removes the worktree folder and prunes its registration', async () => {
    const sha = commit(repo, 'file.txt', 'hi\n', 'v1')

    const mgr = new PrWorktreeManager({ cacheDir })
    const path = await mgr.acquire(repo, sha)
    expect(git(repo, 'worktree list')).toContain(path)

    await mgr.release(repo, sha)

    expect(existsSync(path)).toBe(false)
    expect(git(repo, 'worktree list')).not.toContain(path)
  })

  test('sweep cleans up a crash-survivor worktree left by a previous process', async () => {
    const sha = commit(repo, 'file.txt', 'hi\n', 'v1')

    // A previous process acquired a worktree, then crashed without releasing.
    const crashed = new PrWorktreeManager({ cacheDir })
    const path = await crashed.acquire(repo, sha)
    expect(existsSync(path)).toBe(true)

    // Fresh process (no live sessions) sweeps at startup.
    const fresh = new PrWorktreeManager({ cacheDir })
    await fresh.sweep()

    expect(existsSync(path)).toBe(false)
    expect(git(repo, 'worktree list')).not.toContain(path)
  })

  test('sweep prunes a leaked registration whose index entry was lost', async () => {
    const sha = commit(repo, 'file.txt', 'hi\n', 'v1')

    // A real worktree registration exists, but the index entry that tracked it
    // was lost (e.g. a crash between `git worktree add` and the index write).
    const mgr = new PrWorktreeManager({ cacheDir })
    const path = await mgr.acquire(repo, sha)
    rmSync(join(cacheDir, 'index.json'), { force: true })
    expect(git(repo, 'worktree list')).toContain(path)

    const fresh = new PrWorktreeManager({ cacheDir })
    await fresh.sweep()

    // Folder deleted AND the dangling registration pruned from the source repo.
    expect(existsSync(path)).toBe(false)
    expect(git(repo, 'worktree list')).not.toContain(path)
  })

  test('sweep preserves worktrees that are live in the current session', async () => {
    const sha = commit(repo, 'file.txt', 'hi\n', 'v1')

    const mgr = new PrWorktreeManager({ cacheDir })
    const path = await mgr.acquire(repo, sha)

    await mgr.sweep()

    expect(existsSync(path)).toBe(true)
    expect(git(repo, 'worktree list')).toContain(path)
  })

  test('sweep deletes an orphan folder that has no index entry', async () => {
    const sha = commit(repo, 'file.txt', 'hi\n', 'v1')
    const mgr = new PrWorktreeManager({ cacheDir })
    // Materialize the trees dir, then plant a stray folder with no registration.
    await mgr.acquire(repo, sha)
    const orphan = join(cacheDir, 'trees', 'stray-folder')
    mkdirSync(orphan, { recursive: true })
    writeFileSync(join(orphan, 'junk.txt'), 'junk\n')

    const fresh = new PrWorktreeManager({ cacheDir })
    await fresh.sweep()

    expect(existsSync(orphan)).toBe(false)
  })

  test('LRU disk cap reclaims the least-recently-used IDLE worktree', async () => {
    const sha1 = commit(repo, 'file.txt', 'one\n', 'v1')
    const sha2 = commit(repo, 'file.txt', 'two\n', 'v2')
    const sha3 = commit(repo, 'file.txt', 'three\n', 'v3')

    // A previous session left two idle (non-live) worktrees cached on disk.
    const prev = new PrWorktreeManager({ cacheDir, maxWorktrees: 10 })
    const p1 = await prev.acquire(repo, sha1)
    const p2 = await prev.acquire(repo, sha2)

    // A new session with a tight cap opens a third PR; the cap must reclaim.
    const mgr = new PrWorktreeManager({ cacheDir, maxWorktrees: 2 })
    const p3 = await mgr.acquire(repo, sha3)

    // sha1 was least-recently used among the idle worktrees → evicted.
    expect(existsSync(p1)).toBe(false)
    expect(existsSync(p2)).toBe(true)
    expect(existsSync(p3)).toBe(true)
    expect(git(repo, 'worktree list')).not.toContain(p1)
  })

  test('LRU eviction removes idle worktrees in least-recently-used order', async () => {
    const sha1 = commit(repo, 'file.txt', 'one\n', 'v1')
    const sha2 = commit(repo, 'file.txt', 'two\n', 'v2')
    const sha3 = commit(repo, 'file.txt', 'three\n', 'v3')
    const sha4 = commit(repo, 'file.txt', 'four\n', 'v4')

    // Previous session cached three idle worktrees, oldest → newest.
    const prev = new PrWorktreeManager({ cacheDir, maxWorktrees: 10 })
    const p1 = await prev.acquire(repo, sha1)
    const p2 = await prev.acquire(repo, sha2)
    const p3 = await prev.acquire(repo, sha3)

    // New session (cap 2) opens a fourth PR; the two OLDEST idle ones go.
    const mgr = new PrWorktreeManager({ cacheDir, maxWorktrees: 2 })
    const p4 = await mgr.acquire(repo, sha4)

    expect(existsSync(p1)).toBe(false)
    expect(existsSync(p2)).toBe(false)
    expect(existsSync(p3)).toBe(true)
    expect(existsSync(p4)).toBe(true)
  })

  test('LRU disk cap never evicts a worktree that is live in this session', async () => {
    const sha1 = commit(repo, 'file.txt', 'one\n', 'v1')
    const sha2 = commit(repo, 'file.txt', 'two\n', 'v2')
    const sha3 = commit(repo, 'file.txt', 'three\n', 'v3')

    // Cap of 2, but all three are acquired (and held) by THIS session.
    const mgr = new PrWorktreeManager({ cacheDir, maxWorktrees: 2 })
    const p1 = await mgr.acquire(repo, sha1)
    const p2 = await mgr.acquire(repo, sha2)
    const p3 = await mgr.acquire(repo, sha3)

    // Exceeding the cap must NOT pull a live checkout out from under the session.
    expect(existsSync(p1)).toBe(true)
    expect(existsSync(p2)).toBe(true)
    expect(existsSync(p3)).toBe(true)
    const list = git(repo, 'worktree list')
    expect(list).toContain(p1)
    expect(list).toContain(p2)
    expect(list).toContain(p3)
  })

  test('releaseAll removes every worktree acquired in this session', async () => {
    const sha1 = commit(repo, 'a.txt', 'a\n', 'v1')
    const sha2 = commit(repo, 'b.txt', 'b\n', 'v2')

    const mgr = new PrWorktreeManager({ cacheDir })
    const p1 = await mgr.acquire(repo, sha1)
    const p2 = await mgr.acquire(repo, sha2)

    await mgr.releaseAll()

    expect(existsSync(p1)).toBe(false)
    expect(existsSync(p2)).toBe(false)
  })

  test('clear removes all cached worktrees', async () => {
    const sha1 = commit(repo, 'a.txt', 'a\n', 'v1')
    const sha2 = commit(repo, 'b.txt', 'b\n', 'v2')

    const mgr = new PrWorktreeManager({ cacheDir })
    const p1 = await mgr.acquire(repo, sha1)
    const p2 = await mgr.acquire(repo, sha2)

    await mgr.clear()

    expect(existsSync(p1)).toBe(false)
    expect(existsSync(p2)).toBe(false)
    const list = git(repo, 'worktree list')
    expect(list).not.toContain(p1)
    expect(list).not.toContain(p2)
  })
})
