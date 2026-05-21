import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export type DiffSourceSpec = { type: 'working-tree-vs-head' }

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface DiffLine {
  type: 'context' | 'add' | 'delete'
  oldLineNum?: number
  newLineNum?: number
  content: string
}

export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  oldPath?: string
  status: FileStatus
  isBinary: boolean
  hunks: Hunk[]
}

export interface DiffData {
  files: FileDiff[]
}

const STATUS_MAP: Record<string, FileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted'
}

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: repo, maxBuffer: 50 * 1024 * 1024 })
  return stdout
}

interface FileHeader {
  path: string
  oldPath?: string
  status: FileStatus
}

function parseFileHeaders(nameStatus: string): Map<string, FileHeader> {
  const map = new Map<string, FileHeader>()
  for (const line of nameStatus.split('\n').filter(Boolean)) {
    const parts = line.split('\t')
    const statusCode = parts[0][0]

    if (statusCode === 'R') {
      const [, oldPath, newPath] = parts
      map.set(newPath, { path: newPath, oldPath, status: 'renamed' })
      continue
    }

    const status = STATUS_MAP[statusCode]
    if (!status) continue
    const path = parts[1]
    map.set(path, { path, status })
  }
  return map
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

function parseHunks(patch: string): Map<string, { isBinary: boolean; hunks: Hunk[] }> {
  const result = new Map<string, { isBinary: boolean; hunks: Hunk[] }>()
  const lines = patch.split('\n')

  let i = 0
  let currentPath: string | null = null
  let currentEntry: { isBinary: boolean; hunks: Hunk[] } | null = null
  let currentHunk: Hunk | null = null
  let oldLineCursor = 0
  let newLineCursor = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('diff --git ')) {
      currentHunk = null
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
      currentPath = match ? match[2] : null
      currentEntry = { isBinary: false, hunks: [] }
      if (currentPath) result.set(currentPath, currentEntry)
      i++
      continue
    }

    if (!currentEntry) {
      i++
      continue
    }

    if (line.startsWith('Binary files ')) {
      currentEntry.isBinary = true
      i++
      continue
    }

    const hunkMatch = line.match(HUNK_HEADER_RE)
    if (hunkMatch) {
      currentHunk = {
        oldStart: Number(hunkMatch[1]),
        oldLines: hunkMatch[2] ? Number(hunkMatch[2]) : 1,
        newStart: Number(hunkMatch[3]),
        newLines: hunkMatch[4] ? Number(hunkMatch[4]) : 1,
        lines: []
      }
      oldLineCursor = currentHunk.oldStart
      newLineCursor = currentHunk.newStart
      currentEntry.hunks.push(currentHunk)
      i++
      continue
    }

    if (!currentHunk) {
      i++
      continue
    }

    if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        oldLineNum: oldLineCursor,
        newLineNum: newLineCursor,
        content: line.slice(1)
      })
      oldLineCursor++
      newLineCursor++
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      currentHunk.lines.push({
        type: 'delete',
        oldLineNum: oldLineCursor,
        content: line.slice(1)
      })
      oldLineCursor++
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      currentHunk.lines.push({
        type: 'add',
        newLineNum: newLineCursor,
        content: line.slice(1)
      })
      newLineCursor++
    }
    i++
  }

  return result
}

async function diffAgainstNothing(repoPath: string, path: string): Promise<string> {
  try {
    const { stdout } = await exec(
      'git',
      ['diff', '--no-color', '--no-index', '/dev/null', path],
      { cwd: repoPath, maxBuffer: 50 * 1024 * 1024 }
    )
    return stdout
  } catch (err) {
    const e = err as { code?: number; stdout?: string }
    if (e.code === 1 && typeof e.stdout === 'string') return e.stdout
    return ''
  }
}

function looksBinary(buffer: Buffer): boolean {
  const sampleLen = Math.min(buffer.length, 8000)
  for (let i = 0; i < sampleLen; i++) {
    if (buffer[i] === 0) return true
  }
  return false
}

async function loadUntracked(repoPath: string, path: string): Promise<FileDiff> {
  const buffer = await readFile(join(repoPath, path))
  if (looksBinary(buffer)) {
    return { path, status: 'added', isBinary: true, hunks: [] }
  }
  const text = buffer.toString('utf8')
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    return { path, status: 'added', isBinary: false, hunks: [] }
  }
  const hunkLines: DiffLine[] = lines.map((content, idx) => ({
    type: 'add',
    newLineNum: idx + 1,
    content
  }))
  return {
    path,
    status: 'added',
    isBinary: false,
    hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: hunkLines }]
  }
}

export class GitDiffProvider {
  async getRawPatch(repoPath: string, source: DiffSourceSpec): Promise<string> {
    if (source.type !== 'working-tree-vs-head') {
      throw new Error(`Unsupported diff source: ${source.type}`)
    }

    const [tracked, untrackedList] = await Promise.all([
      git(repoPath, ['diff', '-M', '--no-color', 'HEAD']),
      git(repoPath, ['ls-files', '--others', '--exclude-standard'])
    ])

    const untracked = untrackedList.split('\n').filter(Boolean)
    const untrackedPatches: string[] = []
    for (const path of untracked) {
      const patch = await diffAgainstNothing(repoPath, path)
      if (patch) untrackedPatches.push(patch)
    }

    return [tracked, ...untrackedPatches].filter(s => s.length > 0).join('')
  }

  async getDiff(repoPath: string, source: DiffSourceSpec): Promise<DiffData> {
    if (source.type !== 'working-tree-vs-head') {
      throw new Error(`Unsupported diff source: ${source.type}`)
    }

    const [nameStatus, patch, untrackedList] = await Promise.all([
      git(repoPath, ['diff', '--name-status', '-M', '--no-color', 'HEAD']),
      git(repoPath, ['diff', '-M', '--no-color', 'HEAD']),
      git(repoPath, ['ls-files', '--others', '--exclude-standard'])
    ])

    const headers = parseFileHeaders(nameStatus)
    const patches = parseHunks(patch)

    const files: FileDiff[] = []
    for (const { path, oldPath, status } of headers.values()) {
      const entry = patches.get(path) ?? { isBinary: false, hunks: [] }
      files.push({ path, oldPath, status, isBinary: entry.isBinary, hunks: entry.hunks })
    }

    const untracked = untrackedList.split('\n').filter(Boolean)
    for (const path of untracked) {
      files.push(await loadUntracked(repoPath, path))
    }

    return { files }
  }
}
