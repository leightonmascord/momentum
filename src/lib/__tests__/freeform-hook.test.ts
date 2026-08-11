import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDashboardWidgets, DEFAULT_CONFIGS, DEFAULT_FREEFORM_SIZE } from '../use-dashboard-widgets'

class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length() { return this.store.size }
  clear() { this.store.clear() }
  getItem(key: string) { return this.store.get(key) ?? null }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null }
  removeItem(key: string) { this.store.delete(key) }
  setItem(key: string, value: string) { this.store.set(key, value) }
}

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage()
})

function seedConfigs(widgets: string[], configs: Record<string, { x: number; y: number; width: number; height: number; cols: number; rows: number; order: number }>) {
  const storage = globalThis.localStorage as MemoryStorage
  storage.setItem('momentum-dashboard-widgets', JSON.stringify(widgets))
  storage.setItem('momentum-dashboard-configs', JSON.stringify(configs))
  storage.setItem('momentum-dashboard-layout', 'freeform')
}

describe('useDashboardWidgets — freeform cascade', () => {
  it('initialises overlapping widgets into a cascade with no overlap', () => {
    seedConfigs(['a', 'b'], {
      a: { x: 0, y: 0, width: 320, height: 280, cols: 1, rows: 1, order: 0 },
      b: { x: 0, y: 0, width: 320, height: 280, cols: 1, rows: 1, order: 1 },
    })
    const { result } = renderHook(() => useDashboardWidgets())
    const a = result.current.widgetConfigs['a']!
    const b = result.current.widgetConfigs['b']!
    // No overlap: a and b don't share a rectangle.
    const aRight = a.x! + (a.width ?? 0)
    const aBottom = a.y! + (a.height ?? 0)
    const bRight = b.x! + (b.width ?? 0)
    const bBottom = b.y! + (b.height ?? 0)
    const overlapsX = !(aRight + 8 <= b.x! || bRight + 8 <= a.x!)
    const overlapsY = !(aBottom + 8 <= b.y! || bBottom + 8 <= a.y!)
    expect(overlapsX && overlapsY).toBe(false)
    // 2D packing: b should be placed next to a horizontally, not forced below.
    // Specifically b.y should equal a.y (same row) since a is processed first.
    expect(b.y).toBe(a.y)
  })

  it('toggling a widget off then on does not leave it as a phantom blocker', () => {
    seedConfigs(['a', 'b'], {
      a: { x: 0, y: 0, width: 320, height: 280, cols: 1, rows: 1, order: 0 },
      b: { x: 0, y: 320, width: 320, height: 280, cols: 1, rows: 1, order: 1 },
    })
    const { result } = renderHook(() => useDashboardWidgets())
    act(() => result.current.setVisibleWidgets(['a']))
    act(() => result.current.runCascade())
    expect(result.current.widgetConfigs['a'].y).toBe(0)
    act(() => result.current.setVisibleWidgets(['a', 'b']))
    act(() => result.current.runCascade())
    const a = result.current.widgetConfigs['a']!
    const b = result.current.widgetConfigs['b']!
    // b should pack into the freed gap (right of a) so it doesn't overlap a.
    const aRight = a.x! + (a.width ?? 0) + 8
    const aBottom = a.y! + (a.height ?? 0) + 8
    const noOverlap = aRight <= b.x! || aBottom <= b.y!
    expect(noOverlap).toBe(true)
  })

  it('runCascade(pinnedId) keeps the pinned widget exactly where it is', () => {
    seedConfigs(['a', 'b'], {
      a: { x: 0, y: 0, width: 320, height: 280, cols: 1, rows: 1, order: 0 },
      b: { x: 0, y: 320, width: 320, height: 280, cols: 1, rows: 1, order: 1 },
    })
    const { result } = renderHook(() => useDashboardWidgets())
    act(() => result.current.setWidgetPx('a', { x: 0, y: 200 }, true))
    act(() => result.current.runCascade('a'))
    expect(result.current.widgetConfigs['a'].y).toBe(200)
    const a = result.current.widgetConfigs['a']!
    const b = result.current.widgetConfigs['b']!
    // b should not overlap the pinned widget a.
    const noOverlap =
      a.x! + (a.width ?? 0) + 8 <= b.x! ||
      b.x! + (b.width ?? 0) + 8 <= a.x! ||
      a.y! + (a.height ?? 0) + 8 <= b.y! ||
      b.y! + (b.height ?? 0) + 8 <= a.y!
    expect(noOverlap).toBe(true)
  })

  it('ensureFreeformDefaults with containerWidth wraps to measured width', () => {
    const storage = globalThis.localStorage as MemoryStorage
    storage.setItem('momentum-dashboard-widgets', JSON.stringify(Object.keys(DEFAULT_CONFIGS)))
    storage.setItem('momentum-dashboard-configs', JSON.stringify(DEFAULT_CONFIGS))
    storage.setItem('momentum-dashboard-layout', 'grid')
    const { result } = renderHook(() => useDashboardWidgets())
    act(() => result.current.setMode('freeform', 800))
    const first = result.current.widgetConfigs[Object.keys(DEFAULT_CONFIGS)[0]]
    expect(first.x).toBe(0)
    expect(first.y).toBe(0)
  })

  it('setWidgetPx with skipOverlap=true writes raw values verbatim', () => {
    seedConfigs(['a', 'b'], {
      a: { x: 0, y: 0, width: 320, height: 280, cols: 1, rows: 1, order: 0 },
      b: { x: 0, y: 320, width: 320, height: 280, cols: 1, rows: 1, order: 1 },
    })
    const { result } = renderHook(() => useDashboardWidgets())
    act(() => result.current.setWidgetPx('a', { x: 0, y: 320 }, true))
    expect(result.current.widgetConfigs['a'].y).toBe(320)
  })

  it('switching to freeform populates default sizes for every widget', () => {
    const { result } = renderHook(() => useDashboardWidgets())
    act(() => result.current.setMode('freeform'))
    for (const [id, expected] of Object.entries(DEFAULT_FREEFORM_SIZE)) {
      expect(result.current.widgetConfigs[id]?.width, `${id} width`).toBe(expected.width)
      expect(result.current.widgetConfigs[id]?.height, `${id} height`).toBe(expected.height)
    }
  })
})
