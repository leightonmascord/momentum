import { useState, useEffect, useCallback } from 'react'

export type LayoutMode = 'grid' | 'freeform'

export interface WidgetConfig {
  id: string
  label: string
  cols: number
  rows: number
  order: number
  /** Freeform-mode absolute position in pixels, relative to the canvas. */
  x?: number
  y?: number
  /** Freeform-mode pixel size. */
  width?: number
  height?: number
}

export const MIN_WIDGET_COLS = 1
export const MAX_WIDGET_COLS = 3
export const MIN_WIDGET_ROWS = 1
export const MAX_WIDGET_ROWS = 3

/** Freeform-mode pixel bounds. Small enough that the widget stays usable, large
 *  enough to fit its contents on a phone-width screen. */
export const MIN_WIDGET_PX_W = 220
export const MIN_WIDGET_PX_H = 160
export const MAX_WIDGET_PX_W = 1200
export const MAX_WIDGET_PX_H = 1600

export const LAYOUT_STORAGE_KEY = 'momentum-dashboard-layout'

export const DASHBOARD_WIDGETS_METADATA: { id: string; label: string }[] = [
  { id: 'today',        label: 'Today' },
  { id: 'pomodoro',     label: 'Study Timer' },
  { id: 'study-review', label: 'Study Review' },
  { id: 'calendar',     label: 'Study Calendar' },
  { id: 'recent',       label: 'Recent Sessions' },
  { id: 'assignments',  label: 'Upcoming Assignments' },
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

/** Default pixel size for a widget entering freeform mode without one saved. */
export const DEFAULT_FREEFORM_SIZE: Record<string, { width: number; height: number }> = {
  today:        { width: 460, height: 280 },
  pomodoro:     { width: 320, height: 360 },
  'study-review': { width: 320, height: 360 },
  calendar:     { width: 460, height: 360 },
  recent:       { width: 460, height: 360 },
  assignments:  { width: 320, height: 280 },
  'study-streak': { width: 320, height: 360 },
}

export function useDashboardWidgets() {
  const [visibleWidgets, setVisibleWidgets] = useState<string[]>(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_WIDGET_IDS
    try {
      const saved = localStorage.getItem('momentum-dashboard-widgets')
      if (!saved) return DEFAULT_WIDGET_IDS
      const parsed = JSON.parse(saved)
      if (!Array.isArray(parsed)) return DEFAULT_WIDGET_IDS
      const validIds = new Set(DASHBOARD_WIDGETS_METADATA.map(w => w.id))
      return parsed.filter((id: string) => validIds.has(id))
    } catch {
      return DEFAULT_WIDGET_IDS
    }
  })

  const [widgetConfigs, setWidgetConfigs] = useState<Record<string, Omit<WidgetConfig, 'id' | 'label'>>>(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_CONFIGS
    try {
      const saved = localStorage.getItem('momentum-dashboard-configs')
      if (!saved) return DEFAULT_CONFIGS
      return JSON.parse(saved)
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
    setWidgetConfigs(prev => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_CONFIGS[id]), ...config } }))
  }, [])

  const reorderWidgets = useCallback((fromId: string, toId: string) => {
    setVisibleWidgets(prev => {
      const result = [...prev]
      const fromIndex = result.indexOf(fromId)
      const toIndex = result.indexOf(toId)
      if (fromIndex === -1 || toIndex === -1) return prev
      result.splice(fromIndex, 1)
      result.splice(toIndex, 0, fromId)
      return result
    })
  }, [])

  const setWidgetSize = useCallback((id: string, cols: number, rows: number) => {
    setWidgetConfigs(prev => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_CONFIGS[id]), cols: Math.max(MIN_WIDGET_COLS, Math.min(MAX_WIDGET_COLS, cols)), rows: Math.max(MIN_WIDGET_ROWS, Math.min(MAX_WIDGET_ROWS, rows)) } }))
  }, [])
  const cycleWidgetSize = useCallback((id: string) => {
    setWidgetConfigs(prev => {
      const current = prev[id] ?? DEFAULT_CONFIGS[id]
      if (!current) return prev
      const nextCols = current.cols >= MAX_WIDGET_COLS ? MIN_WIDGET_COLS : current.cols + 1
      return { ...prev, [id]: { ...current, cols: nextCols } }
    })
  }, [])

  const setWidgetPx = useCallback((id: string, partial: { x?: number; y?: number; width?: number; height?: number }) => {
    setWidgetConfigs(prev => {
      const cur = prev[id] ?? DEFAULT_CONFIGS[id]
      const defaults = DEFAULT_FREEFORM_SIZE[id] ?? { width: 360, height: 280 }
      const next = {
        ...cur,
        x: clampPx(partial.x ?? cur.x ?? 0,MIN_WIDGET_PX_W, 4000),
        y: clampPx(partial.y ?? cur.y ?? 0, MIN_WIDGET_PX_H, 4000),
        width: clampPx(partial.width ?? cur.width ?? defaults.width, MIN_WIDGET_PX_W, MAX_WIDGET_PX_W),
        height: clampPx(partial.height ?? cur.height ?? defaults.height, MIN_WIDGET_PX_H, MAX_WIDGET_PX_H),
      }
      return { ...prev, [id]: next }
    })
  }, [])

  /** Ensure every visible widget has freeform dimensions. Called when entering freeform mode. */
  const ensureFreeformDefaults = useCallback(() => {
    setWidgetConfigs(prev => {
      const next = { ...prev }
      for (const id of visibleWidgets) {
        const cur = next[id] ?? DEFAULT_CONFIGS[id]
        const defaults = DEFAULT_FREEFORM_SIZE[id] ?? { width: 360, height: 280 }
        let x = cur.x, y = cur.y, w = cur.width, h = cur.height
        if (w === undefined) w = defaults.width
        if (h === undefined) h = defaults.height
        if (x === undefined) x = 0
        if (y === undefined) y = 0
        next[id] = { ...cur, x, y, width: w, height: h }
      }
      return next
    })
  }, [visibleWidgets])

  const setMode = useCallback((mode: LayoutMode) => {
    if (mode === 'freeform') ensureFreeformDefaults()
    setLayoutMode(mode)
  }, [ensureFreeformDefaults])

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
    reorderWidgets
  }
}

function clampPx(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}
