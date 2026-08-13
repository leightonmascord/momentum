import { useState, useEffect, useCallback } from 'react'

export interface WidgetConfig {
  id: string
  label: string
  cols: number
  rows: number
  /** Which column (0, 1, or 2) the widget sits in for grid mode. */
  column: number
  /** Order within the column. */
  order: number
  width?: number
  height?: number
  x?: number
  y?: number
}

export const MIN_WIDGET_COLS = 1
export const MAX_WIDGET_COLS = 3
export const MIN_WIDGET_ROWS = 1
export const MAX_WIDGET_ROWS = 3


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
    // Spread defaults across 3 columns so column 0 isn't empty on first load.
    const column = Math.min(2, Math.floor((i / DASHBOARD_WIDGETS_METADATA.length) * 3))
    acc[w.id] = { cols, rows, column, order: i }
    return acc
  }, {} as Record<string, Omit<WidgetConfig, 'id' | 'label'>>)
export const DEFAULT_WIDGET_IDS = DASHBOARD_WIDGETS_METADATA.map((w) => w.id)

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

  const [widgetConfigs, setWidgetConfigs] = useState<Record<string, Omit<WidgetConfig, 'id' | 'label'>>>(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_CONFIGS
    try {
      const saved = localStorage.getItem('momentum-dashboard-configs')
      return saved ? JSON.parse(saved) : DEFAULT_CONFIGS
    } catch {
      return DEFAULT_CONFIGS
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('momentum-dashboard-widgets', JSON.stringify(visibleWidgets))
      localStorage.setItem('momentum-dashboard-configs', JSON.stringify(widgetConfigs))
    } catch { /* ignore */ }
  }, [visibleWidgets, widgetConfigs])

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

  // Move a widget to a specific column at a specific position within that
  // column. Reorders the visible list and rewrites the widget's column +
  // order config so it renders in the destination column.
  const moveWidgetToColumn = useCallback((widgetId: string, toColumn: number, beforeId?: string | null) => {
    const toCol = Math.max(0, Math.min(2, Math.floor(toColumn)))
    setVisibleWidgets((prev) => {
      const fromIndex = prev.indexOf(widgetId)
      if (fromIndex === -1) return prev
      const without = prev.filter((id) => id !== widgetId)
      let insertAt = without.length
      if (beforeId) {
        const idx = without.indexOf(beforeId)
        if (idx !== -1) insertAt = idx
      }
      const next = [...without.slice(0, insertAt), widgetId, ...without.slice(insertAt)]
      // Persist the column assignment so it survives reload.
      setWidgetConfigs((cfg) => {
        const cur = cfg[widgetId] ?? DEFAULT_CONFIGS[widgetId] ?? { cols: 1, rows: 1, column: 0, order: 0 }
        // Re-normalize order within each column so the render order is stable.
        const updated: Record<string, Omit<WidgetConfig, 'id' | 'label'>> = { ...cfg, [widgetId]: { ...cur, column: toCol } }
        // Compute per-column order from the visible list.
        const byCol: Record<number, string[]> = { 0: [], 1: [], 2: [] }
        for (const id of next) {
          const c = updated[id] ?? DEFAULT_CONFIGS[id] ?? { cols: 1, rows: 1, column: 0, order: 0 }
          byCol[c.column] = byCol[c.column] || []
          byCol[c.column].push(id)
        }
        for (let col = 0; col < 3; col++) {
          for (let i = 0; i < byCol[col].length; i++) {
            const id = byCol[col][i]
            updated[id] = { ...(updated[id] ?? DEFAULT_CONFIGS[id] ?? { cols: 1, rows: 1, column: col, order: i }), order: i }
          }
        }
        return updated
      })
      return next
    })
  }, [])



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

  return {
    visibleWidgets,
    setVisibleWidgets,
    widgetConfigs,
    setWidgetConfigs,
    setWidgetSize,
    reorderWidgets,
    moveWidgetToColumn,
  }
}
