import { describe, it, expect } from 'vitest'
import { resolveOverlaps, readBoxes, FREEFORM_GAP } from '../use-dashboard-widgets'
import type { Box } from '../use-dashboard-widgets'

const GAP = FREEFORM_GAP

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width + GAP && a.x + a.width + GAP > b.x &&
    a.y < b.y + b.height + GAP && a.y + a.height + GAP > b.y
  )
}

describe('readBoxes', () => {
  it('clamps negative x/y to 0 and supplies defaults', () => {
    const boxes = readBoxes({
      a: { x: -10, y: -5, cols: 1, rows: 1, order: 0 },
      b: { cols: 1, rows: 1, order: 1 },
    })
    expect(boxes[0]).toMatchObject({ x: 0, y: 0, width: 360, height: 280 })
    expect(boxes[1]).toMatchObject({ x: 0, y: 0, width: 360, height: 280 })
  })
})

describe('resolveOverlaps', () => {
  it('returns moved unchanged when no overlaps', () => {
    const moved: Box = { id: 'a', x: 0, y: 0, width: 320, height: 280, order: 0 }
    const blockers: Box[] = [{ id: 'b', x: 500, y: 500, width: 320, height: 280, order: 1 }]
    expect(resolveOverlaps(moved, blockers)).toEqual(moved)
  })

  it('displaces an overlapping widget to the nearest clear slot', () => {
    // Two identical boxes stacked. The nearest non-overlapping position is
    // directly below (y=288), which is a smaller displacement than to the
    // right (x=328), so the widget must move down.
    const moved: Box = { id: 'a', x: 0, y: 0, width: 320, height: 280, order: 0 }
    const blocker: Box = { id: 'b', x: 0, y: 0, width: 320, height: 280, order: 1 }
    const result = resolveOverlaps(moved, [blocker])
    expect(result.x).toBe(0)
    expect(result.y).toBeGreaterThan(0)
    expect(overlaps(result, blocker)).toBe(false)
  })

  it('finds a slot between two blockers', () => {
    const moved: Box = { id: 'c', x: 100, y: 100, width: 300, height: 200, order: 0 }
    const blockers: Box[] = [
      { id: 'a', x: 0, y: 0, width: 400, height: 90, order: 1 },
      { id: 'b', x: 0, y: 0, width: 90, height: 400, order: 2 },
    ]
    const result = resolveOverlaps(moved, blockers)
    for (const b of blockers) {
      expect(overlaps(result, b)).toBe(false)
    }
  })

  it('pushes a resized widget clear of the widget that grew into it', () => {
    // 'a' was resized taller (height 500) and now overlaps 'b' which sits
    // below it. Resolving 'b' must move it clear of the grown 'a'.
    const a: Box = { id: 'a', x: 0, y: 0, width: 320, height: 500, order: 0 }
    const b: Box = { id: 'b', x: 0, y: 300, width: 320, height: 280, order: 1 }
    const result = resolveOverlaps(b, [a])
    expect(overlaps(result, a)).toBe(false)
  })
  it('ignores widgets not in the blockers list (hidden widgets)', () => {
    // 'ghost' is hidden (not a blocker), so an empty blockers list means
    // no overlap to resolve — the widget stays at (0,0).
    const a: Box = { id: 'a', x: 0, y: 0, width: 320, height: 280, order: 0 }
    const result = resolveOverlaps(a, [])
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
  })
})
