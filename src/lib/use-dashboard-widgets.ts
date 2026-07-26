import { useState, useEffect, useCallback } from 'react'

export interface WidgetConfig {
  id: string
  label: string
  cols: number
  rows: number
  order: number
}

export const MIN_WIDGET_COLS = 1
export const MAX_WIDGET_COLS = 3
export const MIN_WIDGET_ROWS = 1
export const MAX_WIDGET_ROWS = 3

export const DASHBOARD_WIDGETS_METADATA: { id: string; label: string }[] = [
  { id: 'today',        label: 'Today' },
  { id: 'pomodoro',     label: 'Study Timer' },
  { id: 'study-review', label: 'Study Review' },
  { id: 'calendar',     label: 'Study Calendar' },
  { id: 'recent',       label: 'Recent Sessions' },
  { id: 'assignments',  label: 'Upcoming Assignments' },
]

export const DEFAULT_CONFIGS: Record<string, Omit<WidgetConfig, 'id' | 'label'>> = 
  DASHBOARD_WIDGETS_METADATA.reduce((acc, w, i) => {
    let cols = 1, rows = 1
    if (w.id === 'today' || w.id === 'calendar' || w.id === 'recent') { cols = 2; rows = 1 }
    if (w.id === 'streak-goal') { cols = 2; rows = 2 }
    acc[w.id] = { cols, rows, order: i }
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
      return Array.isArray(parsed) ? parsed : DEFAULT_WIDGET_IDS
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

  useEffect(() => {
    try {
      localStorage.setItem('momentum-dashboard-widgets', JSON.stringify(visibleWidgets))
      localStorage.setItem('momentum-dashboard-configs', JSON.stringify(widgetConfigs))
    } catch { /* ignore */ }
  }, [visibleWidgets, widgetConfigs])

  const setWidgetConfig = useCallback((id: string, config: Partial<Omit<WidgetConfig, 'id' | 'label'>>) => {
    setWidgetConfigs(prev => ({ ...prev, [id]: { ...prev[id], ...config } }))
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
    setWidgetConfigs(prev => ({ ...prev, [id]: { ...prev[id], cols: Math.max(MIN_WIDGET_COLS, Math.min(MAX_WIDGET_COLS, cols)), rows: Math.max(MIN_WIDGET_ROWS, Math.min(MAX_WIDGET_ROWS, rows)) } }))
  }, [])
  const cycleWidgetSize = useCallback((id: string) => {
    setWidgetConfigs(prev => {
      const current = prev[id]
      const nextCols = current.cols >= MAX_WIDGET_COLS ? MIN_WIDGET_COLS : current.cols + 1
      const nextRows = current.rows >= MAX_WIDGET_ROWS ? MIN_WIDGET_ROWS : current.rows + 1
      return { ...prev, [id]: { ...prev[id], cols: nextCols, rows: nextRows } }
    })
  }, [])

  return {
    visibleWidgets,
    setVisibleWidgets,
    widgetConfigs,
    setWidgetConfigs,
    setWidgetConfig,
    setWidgetSize,
    cycleWidgetSize,
    reorderWidgets
  }
}
