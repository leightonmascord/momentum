import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { db } from '../db/app-db'
import { pullAllData, flushPendingDirtyTables } from '../lib/data-sync'

import type {
  Activity,
  ActivityLog,
  Assignment,
  Category,
  Habit,
  HabitLog,
  Mark,
  Project,
  ProgressLog,
  Routine,
  RoutineLog,
  Session,
  StreakDay,
  Subject,
  StudyArea,
  StudyReview,
} from '../domain/types'
export type AppData = {
  categories: Category[]
  subjects: Subject[]
  projects: Project[]
  sessions: Session[]
  progressLogs: ProgressLog[]
  marks: Mark[]
  assignments: Assignment[]
  habits: Habit[]
  habitLogs: HabitLog[]
  streakDays: StreakDay[]
  routines: Routine[]
  routineLogs: RoutineLog[]
  activities: Activity[]
  activityLogs: ActivityLog[]
  studyAreas: StudyArea[]
  studyReviews: StudyReview[]
}

type ScopeFilter = 'all' | 'academic' | 'nonAcademic'
type RangePreset = 'day' | 'week' | 'month' | 'year' | 'custom'

export interface DataContextValue {
  data: AppData
  isLoading: boolean
  scope: ScopeFilter
  rangePreset: RangePreset
  setScope: (scope: ScopeFilter) => void
  setRangePreset: (preset: RangePreset) => void
  loadData: () => Promise<void>
  /** Apply a partial in-memory state change without re-reading from IndexedDB.
   *  Use after a Dexie write to keep the UI in sync without the cost of a full reload. */
  mutate: (updater: (prev: AppData) => AppData) => void
}

const emptyData: AppData = {
  categories: [],
  subjects: [],
  projects: [],
  sessions: [],
  progressLogs: [],
  marks: [],
  assignments: [],
  habits: [],
  habitLogs: [],
  streakDays: [],
  routines: [],
  routineLogs: [],
  activities: [],
  activityLogs: [],
  studyAreas: [],
  studyReviews: [],
}
async function safeQuery<T>(table: any, order?: { key: string; reverse?: boolean }): Promise<T[]> {
  try {
    if (order) {
      let q = table.orderBy(order.key)
      if (order.reverse) q = q.reverse()
      return await q.toArray()
    }
    return await table.toArray()
  } catch (e) {
    console.warn('[loadAllData] Indexed query failed, falling back to toArray():', e)
    try {
      return await table.toArray()
    } catch (fallbackErr) {
      console.error('[loadAllData] toArray() also failed:', fallbackErr)
      return []
    }
  }
}

async function loadAllData(): Promise<AppData> {
  const data: any = {
    categories: await safeQuery(db.categories, { key: 'name' }),
    subjects: await safeQuery(db.subjects, { key: 'name' }),
    projects: await safeQuery(db.projects, { key: 'name' }),
    sessions: await safeQuery(db.sessions, { key: 'startAt', reverse: true }),
    progressLogs: await safeQuery(db.progressLogs, { key: 'loggedAt', reverse: true }),
    marks: await safeQuery(db.marks, { key: 'date', reverse: true }),
    assignments: await safeQuery(db.assignments),
    habits: await safeQuery(db.habits),
    habitLogs: await safeQuery(db.habitLogs),
    streakDays: await safeQuery(db.streakDays),
    routines: await safeQuery(db.routines, { key: 'name' }),
    routineLogs: await safeQuery(db.routineLogs, { key: 'date', reverse: true }),
    activities: await safeQuery(db.activities, { key: 'name' }),
    activityLogs: await safeQuery(db.activityLogs, { key: 'createdAt', reverse: true }),
    studyAreas: await safeQuery(db.studyAreas, { key: 'name' }),
    studyReviews: await safeQuery(db.studyReviews, { key: 'reviewedAt', reverse: true }),
  }

  return {
    ...data,
    sessions: data.sessions.filter((s: any) => s.startAt && !isNaN(new Date(s.startAt).getTime())),
    progressLogs: data.progressLogs.filter((l: any) => l.loggedAt && !isNaN(new Date(l.loggedAt).getTime())),
    marks: data.marks.filter((m: any) => m.date && !isNaN(new Date(m.date).getTime())),
    habitLogs: data.habitLogs.filter((l: any) => l.date),
    routines: data.routines.map((r: any) => ({ ...r, dayMinutes: r.dayMinutes ?? {} })),
    studyReviews: data.studyReviews.filter((r: any) => r.reviewedAt && !isNaN(new Date(r.reviewedAt).getTime())),
  }
}

const DataContext = createContext<AppData | null>(null)
const DataActionsContext = createContext<Omit<DataContextValue, 'data'> | null>(null)
export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(emptyData)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [scope, setScope] = useState<ScopeFilter>('all')
  const [rangePreset, setRangePreset] = useState<RangePreset>('week')
  const loadTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const pullInProgress = useRef(false)
  const loadData = useCallback(async () => {
    if (pullInProgress.current) return
    if (loadTimer.current) clearTimeout(loadTimer.current)
    loadTimer.current = setTimeout(async () => {
      loadTimer.current = null
      try {
        const data = await loadAllData()
        setData(data)
        setIsInitialLoad(false)
      } catch (e) {
        setIsInitialLoad(false)
      }
    }, 80)
  }, [])
  const mutate = useCallback((updater: (prev: AppData) => AppData) => {
    setData((prev) => updater(prev))
  }, [])
  // On mount: pull cloud data first (if signed in), then load
  useEffect(() => {
    async function init() {
      pullInProgress.current = true
      const timeout = setTimeout(() => {
        if (pullInProgress.current) {
          pullInProgress.current = false
          void loadData()
        }
      }, 10_000)
      try {
        const uid = localStorage.getItem('momentum-cloud-uid')
        if (uid) {
          await pullAllData(uid)
          try {
            const { ensureDailyBackup } = await import('../lib/cloud-backup')
            await ensureDailyBackup(uid)
          } catch (e) {}
        }
      } finally {
        clearTimeout(timeout)
        pullInProgress.current = false
      }
      await loadData()
    }
    void init()
  }, [loadData])
  useEffect(() => {
    function onSynced() { void loadData() }
    window.addEventListener('momentum-data-synced', onSynced)
    return () => window.removeEventListener('momentum-data-synced', onSynced)
  }, [loadData])
  flushPendingDirtyTables()
  const actions = useMemo(
    () => ({ loadData, mutate, scope, rangePreset, setScope, setRangePreset, isLoading: isInitialLoad }),
    [loadData, mutate, scope, rangePreset, setScope, setRangePreset, isInitialLoad],
  )
  return (
    <DataActionsContext.Provider value={actions}>
      <DataContext.Provider value={data}>{children}</DataContext.Provider>
    </DataActionsContext.Provider>
  )
}
export function useData() {
  const data = useContext(DataContext)
  const actions = useContext(DataActionsContext)
  if (!data || !actions) throw new Error('useData must be used within DataProvider')
  return { data, ...actions }
}
export function useDataSelector<T>(selector: (data: AppData) => T): T {
  const data = useContext(DataContext)
  if (!data) throw new Error('useDataSelector must be used within DataProvider')
  return useMemo(() => selector(data), [data])
}

export function useSubjects()       { return useDataSelector(d => d.subjects) }
export function useSessions()        { return useDataSelector(d => d.sessions) }
export function useAssignments()     { return useDataSelector(d => d.assignments) }
