import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { GitDiffProvider } from './git-diff-provider'

function git(repo: string, args: string): string {
  return execSync(`git ${args}`, { cwd: repo, encoding: 'utf8' }).trim()
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dv-test-'))
  git(dir, 'init -q -b main')
  git(dir, 'config user.email test@example.com')
  git(dir, 'config user.name Test')
  git(dir, 'config commit.gpgsign false')
  return dir
}

describe('GitDiffProvider — working tree vs HEAD', () => {
  let repo: string
  const provider = new GitDiffProvider()

  beforeEach(() => {
    repo = initRepo()
    writeFileSync(join(repo, 'README.md'), 'hello\n')
    git(repo, 'add .')
    git(repo, 'commit -q -m init')
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('clean working tree returns no files', async () => {
    const diff = await provider.getDiff(repo, { type: 'working-tree-vs-head' })
    expect(diff.files).toEqual([])
  })

  test('modified file appears with status modified', async () => {
    writeFileSync(join(repo, 'README.md'), 'hello\nworld\n')
    const diff = await provider.getDiff(repo, { type: 'working-tree-vs-head' })
    expect(diff.files.length).toBe(1)
    expect(diff.files[0].path).toBe('README.md')
    expect(diff.files[0].status).toBe('modified')
    expect(diff.files[0].isBinary).toBe(false)
  })

  test('getRawPatch includes untracked files as added blocks', async () => {
    writeFileSync(join(repo, 'fresh.txt'), 'fresh content\n')
    const patch = await provider.getRawPatch(repo, { type: 'working-tree-vs-head' })
    expect(patch).toContain('diff --git a/fresh.txt b/fresh.txt')
    expect(patch).toContain('+fresh content')
  })

  test('staged-vs-head shows files added to the index', async () => {
    writeFileSync(join(repo, 'staged.txt'), 'staged-content\n')
    git(repo, 'add staged.txt')
    // Also modify a file but DON'T stage that change.
    writeFileSync(join(repo, 'README.md'), 'hello\nadded after staging\n')

    const diff = await provider.getDiff(repo, { type: 'staged-vs-head' })
    const paths = diff.files.map(f => f.path).sort()
    expect(paths).toEqual(['staged.txt'])
    expect(diff.files[0].status).toBe('added')
  })

  test('working-tree-vs-staged shows the unstaged delta only', async () => {
    writeFileSync(join(repo, 'shared.txt'), 'first\n')
    git(repo, 'add shared.txt')
    git(repo, 'commit -q -m base')
    writeFileSync(join(repo, 'shared.txt'), 'first\nstaged\n')
    git(repo, 'add shared.txt')
    writeFileSync(join(repo, 'shared.txt'), 'first\nstaged\nunstaged\n')

    const diff = await provider.getDiff(repo, { type: 'working-tree-vs-staged' })
    const file = diff.files.find(f => f.path === 'shared.txt')!
    expect(file.status).toBe('modified')
    const adds = file.hunks.flatMap(h => h.lines.filter(l => l.type === 'add').map(l => l.content))
    expect(adds).toContain('unstaged')
    expect(adds).not.toContain('staged')
  })

  test('branch-vs-base shows commits unique to head', async () => {
    git(repo, 'checkout -q -b feat')
    writeFileSync(join(repo, 'feat.txt'), 'on-branch\n')
    git(repo, 'add feat.txt')
    git(repo, 'commit -q -m feat')

    const diff = await provider.getDiff(repo, {
      type: 'branch-vs-base',
      base: 'main',
      head: 'feat'
    })
    expect(diff.files.map(f => f.path)).toEqual(['feat.txt'])
    expect(diff.files[0].status).toBe('added')
  })

  test('commit-range shows the diff between two commits', async () => {
    writeFileSync(join(repo, 'evolves.txt'), 'v1\n')
    git(repo, 'add evolves.txt')
    git(repo, 'commit -q -m v1')
    const v1 = git(repo, 'rev-parse HEAD')
    writeFileSync(join(repo, 'evolves.txt'), 'v2\n')
    git(repo, 'add evolves.txt')
    git(repo, 'commit -q -m v2')
    const v2 = git(repo, 'rev-parse HEAD')

    const diff = await provider.getDiff(repo, { type: 'commit-range', from: v1, to: v2 })
    const file = diff.files.find(f => f.path === 'evolves.txt')!
    const adds = file.hunks.flatMap(h => h.lines.filter(l => l.type === 'add').map(l => l.content))
    const removes = file.hunks.flatMap(h => h.lines.filter(l => l.type === 'delete').map(l => l.content))
    expect(adds).toEqual(['v2'])
    expect(removes).toEqual(['v1'])
  })

  test('single-commit shows the changes introduced by that commit', async () => {
    writeFileSync(join(repo, 'single.txt'), 'init\n')
    git(repo, 'add single.txt')
    git(repo, 'commit -q -m add-single')
    const sha = git(repo, 'rev-parse HEAD')

    const diff = await provider.getDiff(repo, { type: 'single-commit', sha })
    expect(diff.files.map(f => f.path)).toEqual(['single.txt'])
    expect(diff.files[0].status).toBe('added')
  })

  test('binary file is flagged with isBinary and no hunks', async () => {
    const binary = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0x00, 0x00])
    writeFileSync(join(repo, 'image.bin'), binary)
    git(repo, 'add image.bin')
    git(repo, 'commit -q -m add-bin')
    writeFileSync(join(repo, 'image.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]))

    const diff = await provider.getDiff(repo, { type: 'working-tree-vs-head' })
    const file = diff.files.find(f => f.path === 'image.bin')!
    expect(file.isBinary).toBe(true)
    expect(file.hunks).toEqual([])
  })

  test('renamed file appears with status renamed and oldPath set', async () => {
    writeFileSync(join(repo, 'original.txt'), 'line one\nline two\nline three\n')
    git(repo, 'add original.txt')
    git(repo, 'commit -q -m add-original')
    execSync('git mv original.txt renamed.txt', { cwd: repo })

    const diff = await provider.getDiff(repo, { type: 'working-tree-vs-head' })
    const file = diff.files.find(f => f.path === 'renamed.txt')!
    expect(file.status).toBe('renamed')
    expect(file.oldPath).toBe('original.txt')
  })

  test('deleted file appears with status deleted', async () => {
    writeFileSync(join(repo, 'doomed.txt'), 'gone\n')
    git(repo, 'add doomed.txt')
    git(repo, 'commit -q -m add-doomed')
    rmSync(join(repo, 'doomed.txt'))

    const diff = await provider.getDiff(repo, { type: 'working-tree-vs-head' })
    const file = diff.files.find(f => f.path === 'doomed.txt')!
    expect(file.status).toBe('deleted')
    expect(file.hunks.length).toBe(1)
    expect(file.hunks[0].lines).toEqual([
      { type: 'delete', oldLineNum: 1, content: 'gone' }
    ])
  })

  test('untracked file appears with status added and all lines as adds', async () => {
    writeFileSync(join(repo, 'new.txt'), 'one\ntwo\n')

    const diff = await provider.getDiff(repo, { type: 'working-tree-vs-head' })
    const file = diff.files.find(f => f.path === 'new.txt')!
    expect(file.status).toBe('added')
    expect(file.isBinary).toBe(false)
    expect(file.hunks.length).toBe(1)
    expect(file.hunks[0].lines).toEqual([
      { type: 'add', newLineNum: 1, content: 'one' },
      { type: 'add', newLineNum: 2, content: 'two' }
    ])
  })

  test('hunks expose added/deleted/context lines with correct line numbers', async () => {
    writeFileSync(
      join(repo, 'file.txt'),
      ['a', 'b', 'c', 'd', 'e'].join('\n') + '\n'
    )
    git(repo, 'add file.txt')
    git(repo, 'commit -q -m add')
    writeFileSync(
      join(repo, 'file.txt'),
      ['a', 'B', 'c', 'd', 'e'].join('\n') + '\n'
    )

    const diff = await provider.getDiff(repo, { type: 'working-tree-vs-head' })
    const file = diff.files.find(f => f.path === 'file.txt')!
    expect(file.hunks.length).toBe(1)
    const hunk = file.hunks[0]
    expect(hunk.lines.map(l => ({ type: l.type, content: l.content, old: l.oldLineNum, new: l.newLineNum }))).toEqual([
      { type: 'context', content: 'a', old: 1, new: 1 },
      { type: 'delete', content: 'b', old: 2, new: undefined },
      { type: 'add', content: 'B', old: undefined, new: 2 },
      { type: 'context', content: 'c', old: 3, new: 3 },
      { type: 'context', content: 'd', old: 4, new: 4 },
      { type: 'context', content: 'e', old: 5, new: 5 }
    ])
  })
})
