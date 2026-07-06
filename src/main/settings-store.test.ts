import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from './settings-store'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dv-settings-'))
  file = join(dir, 'settings.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  test('a fresh store has no custom guidance (null = use the shipped default)', () => {
    const store = new SettingsStore(file)
    expect(store.getGuideGuidance()).toBeNull()
  })

  test('set then get returns the saved guidance', () => {
    const store = new SettingsStore(file)
    store.setGuideGuidance('Focus on the auth flow.')
    expect(store.getGuideGuidance()).toBe('Focus on the auth flow.')
  })

  test('setting an empty/whitespace guidance is treated as unset (null)', () => {
    const store = new SettingsStore(file)
    store.setGuideGuidance('real value')
    store.setGuideGuidance('   \n\t ')
    expect(store.getGuideGuidance()).toBeNull()
  })

  test('reset clears the custom guidance back to null', () => {
    const store = new SettingsStore(file)
    store.setGuideGuidance('Custom instructions.')
    store.resetGuideGuidance()
    expect(store.getGuideGuidance()).toBeNull()
  })

  test('persists across instances (survives restart)', () => {
    new SettingsStore(file).setGuideGuidance('Persist me.')
    const reopened = new SettingsStore(file)
    expect(reopened.getGuideGuidance()).toBe('Persist me.')
  })

  test('reset persists across instances', () => {
    const store = new SettingsStore(file)
    store.setGuideGuidance('temp')
    store.resetGuideGuidance()
    expect(new SettingsStore(file).getGuideGuidance()).toBeNull()
  })

  test('writes the file lazily (no file until something is saved)', () => {
    const store = new SettingsStore(file)
    expect(existsSync(file)).toBe(false)
    store.setGuideGuidance('now write')
    expect(existsSync(file)).toBe(true)
  })

  test('a corrupt settings file falls back to defaults instead of throwing', () => {
    writeFileSync(file, '{ this is not valid json ')
    const store = new SettingsStore(file)
    expect(store.getGuideGuidance()).toBeNull()
  })

  test('a file of the wrong shape falls back to defaults', () => {
    writeFileSync(file, JSON.stringify({ guideGuidance: 42 }))
    expect(new SettingsStore(file).getGuideGuidance()).toBeNull()
  })

  test('get() returns a snapshot of the full settings object', () => {
    const store = new SettingsStore(file)
    store.setGuideGuidance('x')
    expect(store.get()).toEqual({ guideGuidance: 'x', repoRoots: [] })
  })
})

describe('SettingsStore repo roots', () => {
  test('a fresh store has no repo roots', () => {
    expect(new SettingsStore(file).getRepoRoots()).toEqual([])
  })

  test('addRepoRoot appends a root', () => {
    const store = new SettingsStore(file)
    store.addRepoRoot('/Users/me/code')
    expect(store.getRepoRoots()).toEqual(['/Users/me/code'])
  })

  test('addRepoRoot is idempotent (no duplicate roots)', () => {
    const store = new SettingsStore(file)
    store.addRepoRoot('/Users/me/code')
    store.addRepoRoot('/Users/me/code')
    expect(store.getRepoRoots()).toEqual(['/Users/me/code'])
  })

  test('addRepoRoot trims and ignores empty/whitespace paths', () => {
    const store = new SettingsStore(file)
    store.addRepoRoot('  /Users/me/code  ')
    store.addRepoRoot('   ')
    expect(store.getRepoRoots()).toEqual(['/Users/me/code'])
  })

  test('addRepoRoot normalizes a trailing slash so it is not stored twice', () => {
    const store = new SettingsStore(file)
    store.addRepoRoot('/Users/me/code')
    store.addRepoRoot('/Users/me/code/')
    expect(store.getRepoRoots()).toEqual(['/Users/me/code'])
  })

  test('removeRepoRoot drops the given root', () => {
    const store = new SettingsStore(file)
    store.addRepoRoot('/a')
    store.addRepoRoot('/b')
    store.removeRepoRoot('/a')
    expect(store.getRepoRoots()).toEqual(['/b'])
  })

  test('repo roots persist across instances', () => {
    new SettingsStore(file).addRepoRoot('/Users/me/work')
    expect(new SettingsStore(file).getRepoRoots()).toEqual(['/Users/me/work'])
  })

  test('repo roots and guidance coexist', () => {
    const store = new SettingsStore(file)
    store.setGuideGuidance('focus on auth')
    store.addRepoRoot('/a')
    const reopened = new SettingsStore(file)
    expect(reopened.getGuideGuidance()).toBe('focus on auth')
    expect(reopened.getRepoRoots()).toEqual(['/a'])
  })

  test('a wrong-shaped repoRoots field falls back to an empty list', () => {
    writeFileSync(file, JSON.stringify({ repoRoots: 'not-an-array' }))
    expect(new SettingsStore(file).getRepoRoots()).toEqual([])
  })

  test('non-string entries in repoRoots are dropped', () => {
    writeFileSync(file, JSON.stringify({ repoRoots: ['/a', 42, '', '/b'] }))
    expect(new SettingsStore(file).getRepoRoots()).toEqual(['/a', '/b'])
  })
})
