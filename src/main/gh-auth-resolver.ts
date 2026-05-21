import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type AuthStatus =
  | { kind: 'authenticated'; user: string }
  | { kind: 'not-authenticated' }
  | { kind: 'gh-not-installed' }
  | { kind: 'error'; message: string }

export interface RunResult {
  stdout: string
  stderr: string
  code: number
}

export type RunCommand = (args: string[]) => Promise<RunResult>

async function realRun(args: string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync('gh', args, { maxBuffer: 1024 * 1024 })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string }
    if (e.code === 'ENOENT') throw err
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: typeof e.code === 'number' ? e.code : 1 }
  }
}

export class GhAuthResolver {
  constructor(private readonly run: RunCommand = realRun) {}

  async status(): Promise<AuthStatus> {
    let result: RunResult
    try {
      result = await this.run(['auth', 'status'])
    } catch (err) {
      const e = err as { code?: string }
      if (e.code === 'ENOENT') return { kind: 'gh-not-installed' }
      return { kind: 'error', message: (err as Error).message }
    }
    const combined = `${result.stdout}\n${result.stderr}`
    const match = combined.match(/Logged in to \S+ account (\S+)/)
    if (match) return { kind: 'authenticated', user: match[1] }
    if (result.code !== 0) return { kind: 'not-authenticated' }
    return { kind: 'error', message: combined.trim() || 'Unknown gh output' }
  }

  async token(): Promise<string | null> {
    try {
      const result = await this.run(['auth', 'token'])
      if (result.code !== 0) return null
      const trimmed = result.stdout.trim()
      return trimmed || null
    } catch {
      return null
    }
  }
}
