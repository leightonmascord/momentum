import { useState, useEffect, useRef, useCallback } from 'react'

export const FREEFORM_GAP = 8
export type LayoutMode = 'grid' | 'freeform'

export interface WidgetConfig {
  id: string
  label: string
  cols: number
  rows: number
  width?: number
  height?: number
  order: number
  x?: number
  y?: number
}

export const MIN_WIDGET_COLS = 1
export const MAX_WIDGET_COLS = 3
export const MIN_WIDGET_ROWS = 1
export const MAX_WIDGET_ROWS = 3
export const MIN_WIDGET_PX_W = 220
export const MIN_WIDGET_PX_H = 160
export const MAX_WIDGET_PX_W = 1200
export const MAX_WIDGET_PX_H = 1600
export const MAX_WIDGET_PX_WIDE = 4000
export const MAX_WIDGET_PX_TALL = 4000
export const LAYOUT_STORAGE_KEY = 'momentum-dashboard-layout'

export const DASHBOARD_WIDGETS_METADATA: { id: string; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'today-checklist', label: "Today's Checklist" },
  { id: 'pomodoro', label: 'Study Timer' },
  { id: 'study-review', label: 'Study Review' },
  { id: 'calendar', label: 'Study Calendar' },
  { id: 'recent', label: 'Recent Sessions' },
  { id: 'assignments', label: 'Upcoming Assignments' },
  { id: 'study-streak', label: 'Study Streak' },
]

export const DEFAULT_CONFIGS: Record<string, Omit<WidgetConfig, 'id' | 'label'>> =
  DASHBOARD_WIDGETS_METADATA.reduce((acc, w, i) => {
    let cols = 1, rows = 1
    if (w.id === 'today' || w.id === 'calendar' || w.id === 'recent') { cols = 2; rows = 1 }
    if (w.id === 'study-streak') { cols = 2; rows = 2 }
    acc[w.id] = { cols, rows, order: i }
    return acc
  }, {} as Record<string, Omit<WidgetConfig, 'id' | 'label'>>)
export const DEFAULT_WIDGET_IDS = DASHBOARD_WIDGETS_METADATA.map((w) => w.id)

export const DEFAULT_FREEFORM_SIZE: Record<string, { width: number; height: number }> = {
  today: { width: 460, height: 280 },
  'today-checklist': { width: 360, height: 360 },
  pomodoro: { width: 320, height: 360 },
  'study-review': { width: 320, height: 360 },
  calendar: { width: 460, height: 360 },
  recent: { width: 460, height: 360 },
  assignments: { width: 320, height: 280 },
  'study-streak': { width: 320, height: 360 },
}

export type Box = { id: string; x: number; y: number; width: number; height: number; order: number }

export function readBoxes(configs: Record<string, Omit<WidgetConfig, 'id' | 'label'>>): Box[] {
  return Object.entries(configs).map(([id, c]) => ({
    id,
    x: Math.max(0, c.x ?? 0),
    y: Math.max(0, c.y ?? 0),
    width: c.width ?? 360,
    height: c.height ?? 280,
    order: c.order ?? 0,
  }))
}

function spansOverlap(aStart: number, aSize: number, bStart: number, bSize: number): boolean {
  return aStart < bStart + bSize + FREEFORM_GAP && aStart + aSize + FREEFORM_GAP > bStart
}

function boxesOverlap(a: Box, b: Box): boolean {
  return spansOverlap(a.x, a.width, b.x, b.width) && spansOverlap(a.y, a.height, b.y, b.height)
}

/**
 * After a drag/resize, if the widget overlaps any blocker, find the position
 * with the smallest displacement that resolves all overlaps. Uses
 * axis-aligned swept collision: for each blocker, compute the minimum
 * shift in the 4 directions (left/right/top/bottom) that separates the
 * two boxes, then pick the shift with the smallest Euclidean distance.
 */
export function resolveOverlaps(moved: Box, blockers: Box[]): Box {
  const overlapping = blockers.filter(b => boxesOverlap(moved, b))
  if (overlapping.length === 0) return moved

  // Build candidate positions from three sources:
  //   1) Cardinal push-outs (align one edge of the moved widget to the
  //      opposite edge of a blocker) — covers the "squeeze between two"
  //      case when a single overlap exists.
  //   2) Corner snap (align top-left with blocker's bottom-right, or
  //      bottom-right with blocker's top-left) — covers the "fit into a
  //      3-widget corner" case.
  //   3) 2D combinations: pin to blocker's edge in one axis and another
  //      blocker's edge in the other axis — covers "slot between 3+ widgets".
  const candidates: Array<{ x: number; y: number }> = []

  for (const b of overlapping) {
    // Cardinal push-outs (1D)
    candidates.push({ x: b.x + b.width + FREEFORM_GAP, y: moved.y })
    candidates.push({ x: b.x - moved.width - FREEFORM_GAP, y: moved.y })
    candidates.push({ x: moved.x, y: b.y + b.height + FREEFORM_GAP })
    candidates.push({ x: moved.x, y: b.y - moved.height - FREEFORM_GAP })
  }

  // Pairwise: for each pair of overlapping blockers, try aligning
  // one edge of the moved widget to one blocker's edge and the other
  // edge to the other blocker's edge. This is the corner slot.
  for (let i = 0; i < overlapping.length; i++) {
    for (let j = 0; j < overlapping.length; j++) {
      if (i === j) continue
      const a = overlapping[i]
      const b = overlapping[j]
      // Top-left corner: widget's top-left aligned to bottom-right of a,
      // widget's right edge pushed past b's left, widget's bottom edge past b's top.
      candidates.push({ x: a.x + a.width + FREEFORM_GAP, y: a.y + a.height + FREEFORM_GAP })
      candidates.push({ x: b.x - moved.width - FREEFORM_GAP, y: b.y + b.height + FREEFORM_GAP })
      candidates.push({ x: a.x + a.width + FREEFORM_GAP, y: b.y - moved.height - FREEFORM_GAP })
      candidates.push({ x: b.x - moved.width - FREEFORM_GAP, y: a.y - moved.height - FREEFORM_GAP })
    }
  }

  let best: { x: number; y: number; dist: number } | null = null
  for (const c of candidates) {
    if (c.x < 0 || c.y < 0) continue
    const test: Box = { ...moved, x: c.x, y: c.y }
    if (blockers.some(b => boxesOverlap(test, b))) continue
    const dist = Math.hypot(c.x - moved.x, c.y - moved.y)
    if (best == null || dist < best.dist) best = { x: c.x, y: c.y, dist }
  }

  if (best) return { ...moved, x: best.x, y: best.y }

  // Fallback: no clean slot — return as-is.
  return moved
}

/**
 * Freeform layout: every widget falls upward as far as possible.
 *
 * - Only `visibleIds` are considered; removed/hidden widgets are ignored
 *   entirely so toggling one off never leaves a hole.
 * - The pinned widget (the one just dropped, if any) is placed first and
 *   treated as an immovable blocker so other widgets fall up around it.
 * - The rest are processed top-to-bottom; each is placed at the highest y
 *   that doesn't overlap any already-placed widget.
 */
function cascadeFreeformLayout(
  configs: Record<string, Omit<WidgetConfig, 'id' | 'label'>>,
  visibleIds: string[],
  pinnedId?: string,
): Record<string, Omit<WidgetConfig, 'id' | 'label'>> {
  const visibleSet = new Set(visibleIds)
  const widgets = readBoxes(configs).filter((b) => visibleSet.has(b.id))
  if (widgets.length === 0) return configs

  const next = { ...configs }
  const placed: Box[] = []

  // The pinned widget (the one just dropped) is authoritative: it stays
  // exactly where it is and acts as a blocker for everyone else, regardless
  // of sort order, so nothing falls into the spot the user chose.
  const pinned = pinnedId ? widgets.find((w) => w.id === pinnedId) : undefined
  if (pinned) {
    placed.push(pinned)
    next[pinned.id] = { ...next[pinned.id], x: pinned.x, y: pinned.y }
  }

  // Fall the rest upward, top-to-bottom, into whatever space remains.
  const sorted = widgets
    .filter((w) => w.id !== pinnedId)
    .slice()
    .sort((a, b) => a.y - b.y || a.order - b.order || a.x - b.x)

  for (const widget of sorted) {
    const settled = placeWithoutOverlap(widget, placed)
    placed.push(settled)
    next[widget.id] = { ...next[widget.id], x: settled.x, y: settled.y }
  }
  return next
}

/**
 * Place a widget at the highest y that doesn't overlap any blocker.
 * Candidate y values are 0 and just below each blocker's bottom edge.
 * Picks the smallest (highest) valid y.
 */
function placeWithoutOverlap(box: Box, blockers: Box[]): Box {
  const candidates = new Set<number>([0])
  for (const blocker of blockers) {
    candidates.add(Math.max(0, blocker.y + blocker.height + FREEFORM_GAP))
  }
  for (const y of [...candidates].sort((a, b) => a - b)) {
    const candidate = { ...box, y }
    if (!blockers.some((b) => boxesOverlap(candidate, b))) {
      return { ...box, y }
    }
  }
  const maxBottom = blockers.reduce((m, b) => Math.max(m, b.y + b.height + FREEFORM_GAP), 0)
  return { ...box, y: maxBottom }
}

export function useDashboardWidgets() {
  const [visibleWidgets, setVisibleWidgets] = useState<string[]>(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_WIDGET_IDS
    try {
      const saved = localStorage.getItem('momentum-dashboard-widgets')
      if (!saved) return DEFAULT_WIDGET_IDS
      const parsed = JSON.parse(saved)
      if (!Array.isArray(parsed)) return DEFAULT_WIDGET_IDS
      const validIds = new Set(DASHBOARD_WIDGETS_METADATA.map((w) => w.id))
      return parsed.filter((id: string) => validIds.has(id))
    } catch {
      return DEFAULT_WIDGET_IDS
    }
  })

  // Mirror of `visibleWidgets` for callbacks that must read the latest list
  // (e.g. `runCascade` is invoked from event handlers that close over the
  // value at render time — without this ref, `toggleWidget` would leave
  // hidden widgets' positions reserved as blockers).
  const visibleWidgetsRef = useRef<string[]>(visibleWidgets)
  useEffect(() => { visibleWidgetsRef.current = visibleWidgets }, [visibleWidgets])

  const [widgetConfigs, setWidgetConfigs] = useState<Record<string, Omit<WidgetConfig, 'id' | 'label'>>>(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_CONFIGS
    try {
      const saved = localStorage.getItem('momentum-dashboard-configs')
      if (!saved) return DEFAULT_CONFIGS
      const parsed = JSON.parse(saved)
      // No visible list known yet on cold start — use the saved configs'
      // own keys. The next state update (when visibleWidgets is hydrated)
      // will trigger a fresh cascade.
      return cascadeFreeformLayout(parsed, Object.keys(parsed))
    } catch {
      return DEFAULT_CONFIGS
    }
  })

  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    if (typeof localStorage === 'undefined') return 'grid'
    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
      return saved === 'freeform' ? 'freeform' : 'grid'
    } catch {
      return 'grid'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('momentum-dashboard-widgets', JSON.stringify(visibleWidgets))
      localStorage.setItem('momentum-dashboard-configs', JSON.stringify(widgetConfigs))
      localStorage.setItem(LAYOUT_STORAGE_KEY, layoutMode)
    } catch { /* ignore */ }
  }, [visibleWidgets, widgetConfigs, layoutMode])

  const setWidgetConfig = useCallback((id: string, config: Partial<Omit<WidgetConfig, 'id' | 'label'>>) => {
    setWidgetConfigs((prev) => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_CONFIGS[id]), ...config } }))
  }, [])

  const reorderWidgets = useCallback((fromId: string, toId: string) => {
    setVisibleWidgets((prev) => {
      const result = [...prev]
      const fromIndex = result.indexOf(fromId)
      const toIndex = result.indexOf(toId)
      if (fromIndex === -1 || toIndex === -1) return prev
      result.splice(fromIndex, 1)
      result.splice(toIndex, 0, fromId)
      return result
    })
  }, [])

  /**
   * Update a widget's pixel position/size. The optional `containerWidth`
   * relaxes the hard `MAX_WIDGET_PX_W` x-cap so widgets on wide monitors
   * can be dragged to the right edge. When `skipOverlap` is true, the
   * raw values are written verbatim (used by drag-preview and resize)
   * and the caller is expected to cascade separately.
   */
  const setWidgetPx = useCallback(
    (id: string, partial: { x?: number; y?: number; width?: number; height?: number }, skipOverlap = false, containerWidth?: number) => {
      setWidgetConfigs((prev) => {
        const cur = prev[id] ?? DEFAULT_CONFIGS[id]
        const defaults = DEFAULT_FREEFORM_SIZE[id] ?? { width: 360, height: 280 }
        // x-cap is the larger of MAX_WIDGET_PX_W and the measured container
        // width — prevents horizontal page scroll while still allowing
        // widgets to use the full width on 4K monitors.
        const maxX = Math.max(MAX_WIDGET_PX_W, containerWidth ?? 0)
        const x = partial.x != null ? Math.max(0, Math.min(maxX, partial.x)) : cur.x ?? 0
        const y = partial.y != null ? Math.max(0, Math.min(MAX_WIDGET_PX_TALL, partial.y)) : cur.y ?? 0
        const width = clampPx(partial.width ?? cur.width ?? defaults.width, MIN_WIDGET_PX_W, MAX_WIDGET_PX_W)
        const height = clampPx(partial.height ?? cur.height ?? defaults.height, MIN_WIDGET_PX_H, MAX_WIDGET_PX_H)
        if (skipOverlap) {
          return { ...prev, [id]: { ...cur, x, y, width, height } }
        }
        const moved: Box = { id, x, y, width, height, order: cur.order ?? 0 }
        const visible = visibleWidgetsRef.current
        const blockers = readBoxes(prev).filter((b) => b.id !== id && visible.includes(b.id))
        const resolved = resolveOverlaps(moved, blockers)
        return { ...prev, [id]: { ...cur, x: resolved.x, y: resolved.y, width: resolved.width, height: resolved.height } }
      })
    },
    [],
  )

  const setWidgetSize = useCallback((id: string, cols: number, rows: number) => {
    setWidgetConfigs((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? DEFAULT_CONFIGS[id]),
        cols: Math.max(MIN_WIDGET_COLS, Math.min(MAX_WIDGET_COLS, cols)),
        rows: Math.max(MIN_WIDGET_ROWS, Math.min(MAX_WIDGET_ROWS, rows)),
      },
    }))
  }, [])

  const cycleWidgetSize = useCallback((id: string) => {
    setWidgetConfigs((prev) => {
      const current = prev[id] ?? DEFAULT_CONFIGS[id]
      if (!current) return prev
      const nextCols = current.cols >= MAX_WIDGET_COLS ? MIN_WIDGET_COLS : current.cols + 1
      return { ...prev, [id]: { ...current, cols: nextCols } }
    })
  }, [])

  /**
   * Lay out visible widgets into a default freeform grid using the
   * measured container width. Called when the user switches to freeform
   * mode for the first time (no saved x/y), or when a widget is added.
   */
  const ensureFreeformDefaults = useCallback((containerWidth?: number) => {
    setWidgetConfigs((prev) => {
      const next = { ...prev }
      const hasSavedFreeformPosition = visibleWidgets.some((id) => next[id]?.x != null || next[id]?.y != null)
      if (!hasSavedFreeformPosition) {
        // Wrap to the measured container width; fall back to a sensible
        // default if the container hasn't been measured yet (e.g. first
        // switch to freeform before layout settled).
        const MAX_ROW = Math.max(360, containerWidth ?? 960)
        let cursorX = 0
        let cursorY = 0
        let rowHeight = 0
        for (const id of visibleWidgets) {
          const cur = next[id] ?? DEFAULT_CONFIGS[id]
          const defaults = DEFAULT_FREEFORM_SIZE[id] ?? { width: 360, height: 280 }
          const width = cur.width ?? defaults.width
          const height = cur.height ?? defaults.height
          if (cursorX > 0 && cursorX + width > MAX_ROW) {
            cursorX = 0
            cursorY += rowHeight + FREEFORM_GAP
            rowHeight = 0
          }
          next[id] = { ...cur, x: cursorX, y: cursorY, width, height }
          cursorX += width + FREEFORM_GAP
          rowHeight = Math.max(rowHeight, height)
        }
      } else {
        for (const id of visibleWidgets) {
          const cur = next[id] ?? DEFAULT_CONFIGS[id]
          const defaults = DEFAULT_FREEFORM_SIZE[id] ?? { width: 360, height: 280 }
          next[id] = {
            ...cur,
            x: cur.x ?? 0,
            y: cur.y ?? 0,
            width: cur.width ?? defaults.width,
            height: cur.height ?? defaults.height,
          }
        }
      }
      return cascadeFreeformLayout(next, visibleWidgets)
    })
  }, [visibleWidgets])

  const setMode = useCallback((mode: LayoutMode, containerWidth?: number) => {
    if (mode === 'freeform') ensureFreeformDefaults(containerWidth)
    setLayoutMode(mode)
  }, [ensureFreeformDefaults])

  /**
   * Re-cascade every visible widget so none overlap. The pinned widget
   * (e.g. the one just dragged) stays put while others fall up around
   * it. Reads the latest visible list via the ref so toggling a widget
   * off-then-on doesn't leave its old position reserved.
   */
  const runCascade = useCallback((pinnedId?: string) => {
    setWidgetConfigs((prev) =>
      cascadeFreeformLayout(prev, visibleWidgetsRef.current, pinnedId),
    )
  }, [])

  return {
    visibleWidgets,
    setVisibleWidgets,
    widgetConfigs,
    setWidgetConfigs,
    layoutMode,
    setMode,
    setWidgetConfig,
    setWidgetSize,
    setWidgetPx,
    cycleWidgetSize,
    reorderWidgets,
    runCascade,
  }
}

function clampPx(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}
