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
    expect(store.get()).toEqual({ guideGuidance: 'x' })
  })
})
