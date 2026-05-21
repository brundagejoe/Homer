import { ipcMain } from 'electron'
import { GitDiffProvider } from './git-diff-provider'

export const CHANNELS = {
  getLocalPatch: 'git:local-patch'
} as const

const provider = new GitDiffProvider()

export function registerIpcHandlers(): void {
  ipcMain.handle(CHANNELS.getLocalPatch, async (_event, repoPath: string) => {
    return provider.getRawPatch(repoPath, { type: 'working-tree-vs-head' })
  })
}
