import { useState, useEffect, useCallback } from 'react'

export interface WidgetConfig {
  id: string
  label: string
  size: 'small' | 'medium' | 'large'
  order: number
}

export const DASHBOARD_WIDGETS_METADATA: { id: string; label: string }[] = [
  { id: 'stats',         label: 'Today & This Week' },
  { id: 'today',        label: 'Today Overview' },
  { id: 'streak-goal',  label: 'Study Streak & Daily Goal' },
  { id: 'pomodoro',     label: 'Study Timer' },
  { id: 'study-review', label: 'Study Review' },
  { id: 'calendar',     label: 'Study Calendar' },
  { id: 'recent',       label: 'Recent Sessions' },
  { id: 'today-schedule', label: "Today's Schedule" },
  { id: 'assignments',  label: 'Upcoming Assignments' },
]

export const DEFAULT_CONFIGS: Record<string, Omit<WidgetConfig, 'id' | 'label'>> = 
  DASHBOARD_WIDGETS_METADATA.reduce((acc, w, i) => {
    let size: WidgetConfig['size'] = 'small'
    if (w.id === 'stats' || w.id === 'today' || w.id === 'calendar' || w.id === 'recent') size = 'medium'
    if (w.id === 'streak-goal') size = 'large'
    acc[w.id] = { size, order: i }
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

  const setWidgetSize = useCallback((id: string, size: WidgetConfig['size']) => {
    setWidgetConfigs(prev => ({ ...prev, [id]: { ...prev[id], size } }))
  }, [])
  const toggleWidgetSize = useCallback((id: string) => {
    setWidgetConfigs(prev => {
      const current = prev[id].size
      const next = current === 'small' ? 'medium' : current === 'medium' ? 'large' : 'small'
      return { ...prev, [id]: { ...prev[id], size: next } }
    })
  }, [])

  return {
    visibleWidgets,
    setVisibleWidgets,
    widgetConfigs,
    setWidgetConfigs,
    setWidgetConfig,
    setWidgetSize,
    reorderWidgets,
    toggleWidgetSize
  }
}
