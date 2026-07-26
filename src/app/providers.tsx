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
async function loadAllData(): Promise<AppData> {
  // Use Dexie indexes where possible to avoid JS-side sorts. Sessions are
  // sorted by startAt desc (no useful index there because startAt is just
  // `id, subjectId, projectId, assignmentId, startAt` — `orderBy('startAt').reverse()`
  // gives us a native sort that uses the index).
  const [
    categories, subjects, projects, sessions, progressLogs,
    marks, assignments, habits, habitLogs, streakDays,
    routines, routineLogs, activities, activityLogs,
    studyAreas, studyReviews,
  ] = await Promise.all([
    db.categories.orderBy('name').toArray(),
    db.subjects.orderBy('name').toArray(),
    db.projects.orderBy('name').toArray(),
    db.sessions.orderBy('startAt').reverse().toArray(),
    db.progressLogs.orderBy('loggedAt').reverse().toArray(),
    db.marks.orderBy('date').reverse().toArray(),
    db.assignments.toArray(),
    db.habits.toArray(),
    db.habitLogs.toArray(),
    db.streakDays.toArray(),
    db.routines.orderBy('name').toArray(),
    db.routineLogs.orderBy('date').reverse().toArray(),
    db.activities.orderBy('name').toArray(),
    db.activityLogs.orderBy('createdAt').reverse().toArray(),
    db.studyAreas.orderBy('name').toArray(),
    db.studyReviews.orderBy('reviewedAt').reverse().toArray(),
  ])

  return {
    categories,
    subjects,
    sessions: sessions.filter((s) => s.startAt && !isNaN(new Date(s.startAt).getTime())),
    projects,
    progressLogs: progressLogs.filter((l) => l.loggedAt && !isNaN(new Date(l.loggedAt).getTime())),
    marks: marks.filter((m) => m.date && !isNaN(new Date(m.date).getTime())),
    assignments,
    habits,
    habitLogs: habitLogs.filter((l) => l.date),
    streakDays,
    routines: routines.map((r) => ({ ...r, dayMinutes: r.dayMinutes ?? {} })),
    routineLogs,
    activities,
    activityLogs,
    studyAreas,
    studyReviews: studyReviews.filter((r) => r.reviewedAt && !isNaN(new Date(r.reviewedAt).getTime())),
  }
}
const DataContext = createContext<DataContextValue | null>(null)

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
        setData(await loadAllData())
      } catch (e) {
        console.error('loadAllData failed:', e)
      } finally {
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
      try {
        const uid = localStorage.getItem('momentum-cloud-uid')
        if (uid) await pullAllData(uid)
      } finally {
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
  // On startup, flush any dirty tables that survived from a previous session
  flushPendingDirtyTables()
  const value = useMemo(
    () => ({ data, isLoading: isInitialLoad, scope, rangePreset, setScope, setRangePreset, loadData, mutate }),
    [data, isInitialLoad, scope, rangePreset, setScope, setRangePreset, loadData, mutate],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
export function useData() {
  const context = useContext(DataContext)
  if (!context) throw new Error('useData must be used within DataProvider')
  return context
}

export function useDataSelector<T>(selector: (data: AppData) => T): T {
  const { data } = useData()
  return useMemo(() => selector(data), [data])
}

export function useSubjects()       { return useDataSelector(d => d.subjects) }
export function useSessions()        { return useDataSelector(d => d.sessions) }
export function useAssignments()     { return useDataSelector(d => d.assignments) }
