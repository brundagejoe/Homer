import { describe, test, expect } from 'bun:test'
import { GenerationRegistry, WindowGenerations, type GenerationWindow } from './generation-registry'

/** A fake WebContents that records its `destroyed` listeners and can fire them. */
function fakeWindow(id: number): GenerationWindow & { destroy: () => void; listenerCount: number } {
  const listeners: Array<() => void> = []
  return {
    id,
    once(_event: 'destroyed', listener: () => void) {
      listeners.push(listener)
    },
    get listenerCount() {
      return listeners.length
    },
    destroy() {
      for (const l of listeners) l()
    }
  }
}

describe('GenerationRegistry', () => {
  test('starting a new generation for a key aborts the previous one', () => {
    const registry = new GenerationRegistry()
    const first = registry.start(1)
    const second = registry.start(1)
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
  })

  test('generations for different keys are independent', () => {
    const registry = new GenerationRegistry()
    const a = registry.start(1)
    const b = registry.start(2)
    expect(a.signal.aborted).toBe(false)
    expect(b.signal.aborted).toBe(false)
  })

  test('abort cancels the current generation for a key', () => {
    const registry = new GenerationRegistry()
    const controller = registry.start(1)
    registry.abort(1)
    expect(controller.signal.aborted).toBe(true)
  })

  test('finish clears the current generation without aborting it', () => {
    const registry = new GenerationRegistry()
    const controller = registry.start(1)
    registry.finish(1, controller)
    expect(controller.signal.aborted).toBe(false)
    // With nothing current, a later abort is a no-op (does not throw).
    expect(() => registry.abort(1)).not.toThrow()
  })

  test('a stale finish does not clobber a newer generation', () => {
    const registry = new GenerationRegistry()
    const first = registry.start(1)
    const second = registry.start(1) // supersedes first
    registry.finish(1, first) // late finish from the aborted run
    // The newer generation is still current, so abort must cancel it.
    registry.abort(1)
    expect(second.signal.aborted).toBe(true)
  })
})

describe('WindowGenerations', () => {
  test('starting a new generation for a window aborts its previous one', () => {
    const generations = new WindowGenerations()
    const win = fakeWindow(1)
    const first = generations.start(win)
    const second = generations.start(win)
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
  })

  test('wires the destroyed listener only once per window', () => {
    const generations = new WindowGenerations()
    const win = fakeWindow(1)
    generations.start(win)
    generations.start(win)
    generations.start(win)
    expect(win.listenerCount).toBe(1)
  })

  test('destroying a window aborts its in-flight generation', () => {
    const generations = new WindowGenerations()
    const win = fakeWindow(1)
    const controller = generations.start(win)
    win.destroy()
    expect(controller.signal.aborted).toBe(true)
  })

  test('finish does not abort and different windows are independent', () => {
    const generations = new WindowGenerations()
    const a = fakeWindow(1)
    const b = fakeWindow(2)
    const controllerA = generations.start(a)
    const controllerB = generations.start(b)
    generations.finish(a, controllerA)
    expect(controllerA.signal.aborted).toBe(false)
    // Finishing A leaves B untouched and still abortable via its own teardown.
    b.destroy()
    expect(controllerB.signal.aborted).toBe(true)
  })
})
