import { ElectronAPI } from '@electron-toolkit/preload'
import type { DiffViewerApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: DiffViewerApi
  }
}
