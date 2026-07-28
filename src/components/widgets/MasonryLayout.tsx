import { useEffect, useState, ReactNode } from 'react'

export interface LayoutWidget {
  id: string
  width: number
  height: number
  children: ReactNode
}

export interface PlacedWidget {
  id: string
  x: number
  y: number
  width: number
  height: number
}

interface MasonryLayoutProps {
  widgets: LayoutWidget[]
  containerWidth: number
  gap?: number
}

/**
 * Cascading masonry layout.
 *
 * Algorithm:
 * 1. Initial placement: fill rows left-to-right.
 * 2. Cascade pass: for each widget, scan upward from its current Y to find
 *    the highest position where it fits horizontally (without overlapping any
 *    already-placed widget). Widgets "fall" into the first gap that fits them.
 *
 * The result is a layout where no widget has empty space beneath it that
 * another widget could have occupied.
 */
function computeLayout(
  widgets: LayoutWidget[],
  containerWidth: number,
  gap: number
): PlacedWidget[] {
  if (widgets.length === 0 || containerWidth <= 0) return []

  // ── Step 1: initial row-based placement ──
  const placed: PlacedWidget[] = []
  let rowX = 0
  let rowY = 0
  let rowHeight = 0

  for (const w of widgets) {
    const wWidth = Math.min(w.width, containerWidth)
    if (rowX + wWidth > containerWidth) {
      rowX = 0
      rowY += rowHeight + gap
      rowHeight = 0
    }
    placed.push({ id: w.id, x: rowX, y: rowY, width: wWidth, height: w.height })
    rowX += wWidth + gap
    if (w.height > rowHeight) rowHeight = w.height
  }

  // ── Step 2: cascade upward into gaps ──
  function overlaps(
    x: number, y: number, w: number, h: number,
    others: PlacedWidget[], skipId: string
  ): boolean {
    return others.some(o =>
      o.id !== skipId &&
      x < o.x + o.width && x + w > o.x &&
      y < o.y + o.height && y + h > o.y
    )
  }

  // Sort by y then x to process top-to-bottom
  placed.sort((a, b) => a.y - b.y || a.x - b.x)

  for (let i = 0; i < placed.length; i++) {
    const w = placed[i]
    let bestY = w.y
    let bestX = w.x

    // Collect candidate Y positions: 0, and the bottom edge of every widget above us
    const candidateYs: number[] = []
    const seenY = new Set<number>()
    candidateYs.push(0)
    seenY.add(0)
    for (let j = 0; j < i; j++) {
      const above = placed[j]
      const bottomEdge = above.y + above.height + gap
      if (bottomEdge < w.y && !seenY.has(bottomEdge)) {
        candidateYs.push(bottomEdge)
        seenY.add(bottomEdge)
      }
    }
    candidateYs.sort((a, b) => a - b)

    for (const testY of candidateYs) {
      if (testY >= bestY) break
      // Try placing at the widget's current X
      if (!overlaps(w.x, testY, w.width, w.height, placed, w.id)) {
        bestY = testY
        bestX = w.x
        break
      }
      // Also try X = 0 (might fit in a left gap)
      if (w.x !== 0 && !overlaps(0, testY, w.width, w.height, placed, w.id)) {
        bestY = testY
        bestX = 0
        break
      }
    }

    w.x = bestX
    w.y = bestY
  }

  // Re-sort for final output
  placed.sort((a, b) => a.y - b.y || a.x - b.x)
  return placed
}

export function MasonryLayout({ widgets, containerWidth, gap = 12 }: MasonryLayoutProps) {
  const [layouts, setLayouts] = useState<PlacedWidget[]>([])

  useEffect(() => {
    setLayouts(computeLayout(widgets, containerWidth, gap))
  }, [widgets, containerWidth, gap])

  const maxY = layouts.reduce((max, l) => Math.max(max, l.y + l.height), 0)
  const containerHeight = Math.max(400, maxY + gap)

  return (
    <div className="relative w-full" style={{ height: containerHeight }}>
      {layouts.map(layout => {
        const widget = widgets.find(w => w.id === layout.id)
        if (!widget) return null
        return (
          <div
            key={layout.id}
            className="absolute"
            style={{
              left: layout.x,
              top: layout.y,
              width: layout.width,
              height: layout.height,
            }}
          >
            {widget.children}
          </div>
        )
      })}
    </div>
  )
}
