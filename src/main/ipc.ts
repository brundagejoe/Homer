import { ipcMain } from 'electron'
import { GitDiffProvider, FileStatus } from './git-diff-provider'

export const CHANNELS = {
  getLocalDiff: 'git:local-diff'
} as const

export interface FileWithPatch {
  path: string
  oldPath?: string
  status: FileStatus
  isBinary: boolean
  patch: string
}

export interface LocalDiffResult {
  files: FileWithPatch[]
}

const provider = new GitDiffProvider()

export function splitPatchByFile(rawPatch: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!rawPatch.trim()) return map
  const lines = rawPatch.split('\n')
  let start = -1
  for (let i = 0; i <= lines.length; i++) {
    const isBoundary = i === lines.length || lines[i].startsWith('diff --git ')
    if (!isBoundary) continue
    if (start >= 0) {
      const slice = lines.slice(start, i).join('\n')
      const match = lines[start].match(/^diff --git a\/(.+?) b\/(.+)$/)
      const path = match ? match[2] : `__file_${map.size}`
      map.set(path, slice)
    }
    start = i
  }
  return map
}

export function registerIpcHandlers(): void {
  ipcMain.handle(CHANNELS.getLocalDiff, async (_event, repoPath: string): Promise<LocalDiffResult> => {
    const source = { type: 'working-tree-vs-head' as const }
    const [data, rawPatch] = await Promise.all([
      provider.getDiff(repoPath, source),
      provider.getRawPatch(repoPath, source)
    ])
    const patches = splitPatchByFile(rawPatch)
    const files: FileWithPatch[] = data.files.map(f => ({
      path: f.path,
      oldPath: f.oldPath,
      status: f.status,
      isBinary: f.isBinary,
      patch: patches.get(f.path) ?? ''
    }))
    return { files }
  })
}
