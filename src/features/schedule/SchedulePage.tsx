import { useState, useMemo } from 'react'
import { format } from 'date-fns'
import { useData } from '../../app/providers'
import { useUndo } from '../../lib/use-undo'
import { db } from '../../db/app-db'
import { Button } from '../../components/ui/Button'
import { Card, CardHeader, CardTitle } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ColorPicker } from '../../components/ui/ColorPicker'
import { Collapsible } from '../../components/ui/Collapsible'
import { cn, isoNow } from '../../lib/utils'
import { v4 as uuid } from 'uuid'
import { useSessionSync } from '../../lib/use-session-sync'
import type { Routine, RoutineLog, Activity, ActivityLog, DayOfWeek, Session, Project } from '../../domain/types'
import { updateStreakDayForSession, updateRoutineLogsForSession } from '../../lib/routine-tracker'
import { sessionIdFor } from '../../lib/timer-persistence'
import { subDays } from 'date-fns'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const DEFAULT_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444']

interface CatchUpItem {
  kind: 'routine' | 'activity'
  id: string
  name: string
  date: string // YYYY-MM-DD of the missed scheduled day
  color: string
}

/**
 * Find the most recent past day (within `windowDays`) on which the item was
 * scheduled but has no log yet. Returns null if every recent scheduled day
 * was already logged/skipped. Starts from yesterday so today's not-yet-logged
 * item is handled by the normal "Mark Done" flow, not the catch-up prompt.
 */
function findMissedDate(
  scheduledDow: (dow: DayOfWeek) => boolean,
  hasLog: (dateStr: string) => boolean,
  windowDays = 14
): string | null {
  for (let i = 1; i <= windowDays; i++) {
    const d = subDays(new Date(), i)
    const ds = format(d, 'yyyy-MM-dd')
    if (scheduledDow(d.getDay() as DayOfWeek) && !hasLog(ds)) return ds
  }
  return null
}

function timeUntil(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number)
  const target = new Date()
  target.setHours(h, m, 0, 0)
  const diffMs = target.getTime() - Date.now()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin > 0) {
    const hr = Math.floor(diffMin / 60)
    const mn = diffMin % 60
    return `Starts in ${hr > 0 ? `${hr}h ` : ''}${mn}m`
  } else if (diffMin > -60) {
    return `Started ${-diffMin}m ago`
  }
  return `Ended ${Math.abs(Math.floor(diffMin / 60))}h ${Math.abs(diffMin) % 60}m ago`
}

function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hh = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hh}:${String(m).padStart(2, '0')} ${period}`
}

function dayPatternLabel(dayMinutes: Partial<Record<DayOfWeek, number>>): string {
  const active = Object.entries(dayMinutes).filter(([, m]) => (m ?? 0) > 0).map(([d]) => WEEKDAYS[Number(d)])
  return active.join(' ')
}

export function SchedulePage() {
  const { data, loadData, mutate } = useData()
  const { push } = useUndo()
  const { syncSession } = useSessionSync()
  const [tab, setTab] = useState<'today' | 'plan'>('today')
  const [routineEditing, setRoutineEditing] = useState<Routine | null>(null)
  const [activityEditing, setActivityEditing] = useState<Activity | null>(null)
  const [cellEditing, setCellEditing] = useState<{ itemId: string; dow: DayOfWeek; minutes: string; isActivity: boolean } | null>(null)
  const [logCustomFor, setLogCustomFor] = useState<string | null>(null)
  const [customMinutes, setCustomMinutes] = useState('')
  const [addRoutineOpen, setAddRoutineOpen] = useState(false)
  const [addActivityOpen, setAddActivityOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const subjects = useMemo(() => data.subjects.filter(s => !s.deletedAt).sort((a, b) => a.name.localeCompare(b.name)), [data.subjects])
  const subjectsMap = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects])
  const projects = useMemo(() => data.projects.filter(p => !p.deletedAt).sort((a, b) => a.name.localeCompare(b.name)), [data.projects])
  const routines = useMemo(() => data.routines.filter(r => !r.deletedAt).sort((a, b) => a.name.localeCompare(b.name)), [data.routines])
  const activities = useMemo(() => data.activities.filter(a => !a.deletedAt).sort((a, b) => a.name.localeCompare(b.name)), [data.activities])

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const dow = new Date().getDay() as DayOfWeek
  const todaysRoutines = useMemo(
    () => routines.filter(r => (r.dayMinutes[dow] ?? 0) > 0).sort((a, b) => a.name.localeCompare(b.name)),
    [routines, dow]
  )

  const todaysActivities = useMemo(
    () => activities
      .filter((a) => (a.dayMinutes[dow] ?? 0) > 0)
      .sort((a, b) => {
        const at = a.scheduledTime ?? '99:99'
        const bt = b.scheduledTime ?? '99:99'
        return at.localeCompare(bt)
      }),
    [activities, dow]
  )
  const DISMISSED_KEY = 'momentum-catchup-dismissed'
  const [dismissed, setDismissed] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}') } catch { return {} }
  })

  const catchUpItems = useMemo(() => {
    const items: CatchUpItem[] = []
    for (const r of data.routines.filter(r => !r.deletedAt)) {
      const missedDate = findMissedDate(
        dow => (r.dayMinutes[dow] ?? 0) > 0,
        ds => data.routineLogs.some(l => l.routineId === r.id && l.date === ds)
      )
      if (!missedDate) continue
      const dismissKey = `${r.id}:${missedDate}`
      if (dismissed[dismissKey]) continue
      items.push({ kind: 'routine', id: r.id, name: r.name, date: missedDate, color: r.color })
    }

    for (const a of data.activities.filter(a => !a.deletedAt)) {
      const missedDate = findMissedDate(
        dow => (a.dayMinutes[dow] ?? 0) > 0,
        ds => data.activityLogs.some(l => l.activityId === a.id && l.date === ds)
      )
      if (!missedDate) continue
      const dismissKey = `${a.id}:${missedDate}`
      if (dismissed[dismissKey]) continue
      items.push({ kind: 'activity', id: a.id, name: a.name, date: missedDate, color: a.color })
    }

    return items
  }, [data.routines, data.routineLogs, data.activities, data.activityLogs, dismissed])

  function dismissCatchUp(id: string, date: string) {
    const next = { ...dismissed, [`${id}:${date}`]: date }
    setDismissed(next)
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
  }

  function confirmCatchUp(item: CatchUpItem) {
    dismissCatchUp(item.id, item.date)

    if (item.kind === 'routine') {
      const routine = data.routines.find(r => r.id === item.id)
      if (!routine) return
      const mins = routine.dayMinutes[new Date(item.date).getDay() as DayOfWeek] ?? 0
      if (mins <= 0) return

      const [y, m, d] = item.date.split('-').map(Number)
      const end = new Date(y, m - 1, d, 12, 0, 0, 0)
      const start = new Date(end.getTime() - mins * 60_000)
      const startAt = start.toISOString()
      const sessionId = sessionIdFor(startAt, routine.subjectId, mins)
      const session: Session = {
        id: sessionId,
        subjectId: routine.subjectId,
        projectId: routine.projectId ?? null,
        routineId: routine.id,
        startAt,
        endAt: end.toISOString(),
        durationMinutes: mins,
        source: 'autoRoutine',
        createdAt: isoNow(),
        updatedAt: isoNow(),
      }
      // Instant UI update FIRST
      mutate(prev => ({ ...prev, sessions: [...prev.sessions, session] }))
      // Fire-and-forget DB writes
      void db.sessions.put(session).catch(err => console.error('Failed to save session:', err))
      const subjectName = subjectsMap.get(routine.subjectId)?.name ?? 'Unknown'
      syncSession(session, subjectName)
      void updateRoutineLogsForSession(session).catch(err => console.error('Failed to update routine logs:', err))
      void updateStreakDayForSession(session).catch(err => console.error('Failed to update streak:', err))
      push({
        description: `Logged ${mins}m for ${routine.name} (catch-up for ${item.date})`,
        undo: async () => {
          await db.sessions.delete(sessionId)
          await loadData()
        },
        redo: async () => {
          await db.sessions.put(session)
          await loadData()
        },
      })
    } else {
      const activity = data.activities.find(a => a.id === item.id)
      if (!activity) return
      const log: ActivityLog = {
        id: uuid(),
        activityId: activity.id,
        date: item.date,
        status: 'completed',
        actualMinutes: activity.dayMinutes[new Date(item.date).getDay() as DayOfWeek] ?? activity.duration ?? 0,
        createdAt: isoNow(),
      }
      // Instant UI update FIRST
      mutate(prev => ({ ...prev, activityLogs: [...prev.activityLogs, log] }))
      // Fire-and-forget DB write
      void db.activityLogs.add(log).catch(err => console.error('Failed to save activity log:', err))
      push({
        description: `Marked ${activity.name} attended (catch-up for ${item.date})`,
        undo: async () => {
          await db.activityLogs.delete(log.id)
          await loadData()
        },
        redo: async () => {
          await db.activityLogs.add(log)
          await loadData()
        },
      })
    }
  }

  function getRoutineLogForToday(routineId: string) {
    return data.routineLogs.find(l => l.routineId === routineId && l.date === todayStr)
  }

  function getActivityLogForToday(activityId: string) {
    return data.activityLogs.find(l => l.activityId === activityId && l.date === todayStr)
  }
  function buildSession(routine: Routine, mins: number): Session {
    const now = new Date()
    const startAt = new Date(now.getTime() - mins * 60 * 1000).toISOString()
    return {
      id: sessionIdFor(startAt, routine.subjectId, mins),
      subjectId: routine.subjectId,
      projectId: routine.projectId ?? null,
      routineId: routine.id,
      startAt,
      endAt: now.toISOString(),
      durationMinutes: mins,
      source: 'autoRoutine',
      createdAt: isoNow(),
      updatedAt: isoNow(),
    }
  }

  function persistSession(session: Session) {
    void db.sessions.put(session).catch(err => console.error('Failed to persist session:', err))
    const subjectName = subjectsMap.get(session.subjectId)?.name ?? 'Unknown'
    syncSession(session, subjectName)
    void updateRoutineLogsForSession(session).catch(err => console.error('Failed to update routine logs:', err))
    void updateStreakDayForSession(session).catch(err => console.error('Failed to update streak day:', err))
  }

  function markDone(routine: Routine) {
    const mins = routine.dayMinutes[dow] ?? 0
    if (mins <= 0) return
    const session = buildSession(routine, mins)
    const existingLog = getRoutineLogForToday(routine.id)
    const logId = existingLog?.id ?? uuid()
    const log: RoutineLog = {
      id: logId,
      routineId: routine.id,
      date: todayStr,
      actualMinutes: mins,
      completed: true,
      createdAt: existingLog?.createdAt ?? isoNow(),
    }
    // Instant UI update FIRST
    mutate(prev => ({
      ...prev,
      sessions: [...prev.sessions, session],
      routineLogs: existingLog
        ? prev.routineLogs.map(l => l.id === logId ? log : l)
        : [...prev.routineLogs, log],
    }))
    // Fire-and-forget DB writes
    persistSession(session)
    void db.routineLogs.put(log).catch(err => console.error('Failed to save routine log:', err))
    push({
      description: `Logged ${mins}m for ${routine.name}`,
      undo: async () => {
        await db.sessions.delete(session.id)
        if (!existingLog) await db.routineLogs.delete(logId)
        await loadData()
      },
      redo: async () => {
        await db.sessions.put(session)
        await db.routineLogs.put(log)
        await loadData()
      },
    })
  }

  function logCustom(routine: Routine, mins: number) {
    if (mins <= 0) return
    const session = buildSession(routine, mins)
    const existingLog = getRoutineLogForToday(routine.id)
    const logId = existingLog?.id ?? uuid()
    const log: RoutineLog = {
      id: logId,
      routineId: routine.id,
      date: todayStr,
      actualMinutes: (existingLog?.actualMinutes ?? 0) + mins,
      completed: false,
      createdAt: existingLog?.createdAt ?? isoNow(),
    }
    // Instant UI update FIRST
    mutate(prev => ({
      ...prev,
      sessions: [...prev.sessions, session],
      routineLogs: existingLog
        ? prev.routineLogs.map(l => l.id === logId ? log : l)
        : [...prev.routineLogs, log],
    }))
    // Fire-and-forget DB writes
    persistSession(session)
    void db.routineLogs.put(log).catch(err => console.error('Failed to save routine log:', err))
    push({
      description: `Logged ${mins}m for ${routine.name}`,
      undo: async () => {
        await db.sessions.delete(session.id)
        if (!existingLog) await db.routineLogs.delete(logId)
        else if (existingLog) await db.routineLogs.put(existingLog)
        await loadData()
      },
      redo: async () => {
        await db.sessions.put(session)
        await db.routineLogs.put(log)
        await loadData()
      },
    })
  }

  function skipRoutine(routine: Routine) {
    const existingLog = getRoutineLogForToday(routine.id)
    if (existingLog) return
    const log: RoutineLog = {
      id: uuid(),
      routineId: routine.id,
      date: todayStr,
      actualMinutes: 0,
      completed: false,
      createdAt: isoNow(),
    }
    // Instant UI update FIRST
    mutate(prev => ({ ...prev, routineLogs: [...prev.routineLogs, log] }))
    // Fire-and-forget DB write
    void db.routineLogs.add(log).catch(err => console.error('Failed to save routine log:', err))
    push({
      description: `Skipped ${routine.name}`,
      undo: async () => { await db.routineLogs.delete(log.id); await loadData() },
      redo: async () => { await db.routineLogs.add(log); await loadData() },
    })
  }

  function skipActivity(activity: Activity) {
    const existingLog = getActivityLogForToday(activity.id)
    if (existingLog) return
    const log: ActivityLog = {
      id: uuid(),
      activityId: activity.id,
      date: todayStr,
      status: 'skipped',
      createdAt: isoNow(),
    }
    // Instant UI update FIRST
    mutate(prev => ({ ...prev, activityLogs: [...prev.activityLogs, log] }))
    // Fire-and-forget DB write
    void db.activityLogs.add(log).catch(err => console.error('Failed to save activity log:', err))
    push({
      description: `Skipped ${activity.name}`,
      undo: async () => { await db.activityLogs.delete(log.id); await loadData() },
      redo: async () => { await db.activityLogs.add(log); await loadData() },
    })
  }

  function attendActivity(activity: Activity) {
    const existingLog = getActivityLogForToday(activity.id)
    if (existingLog) return
    const mins = activity.dayMinutes[dow] ?? activity.duration ?? 0
    const log: ActivityLog = {
      id: uuid(),
      activityId: activity.id,
      date: todayStr,
      status: 'completed',
      actualMinutes: mins,
      createdAt: isoNow(),
    }
    let session: Session | null = null
    if (activity.createsSession && activity.subjectId && mins > 0) {
      const startAt = new Date(Date.now() - mins * 60 * 1000).toISOString()
      session = {
        id: sessionIdFor(startAt, activity.subjectId, mins),
        subjectId: activity.subjectId,
        startAt,
        endAt: new Date().toISOString(),
        durationMinutes: mins,
        source: 'autoRoutine',
        createdAt: isoNow(),
        updatedAt: isoNow(),
      }
    }
    // Instant UI update FIRST
    mutate(prev => ({
      ...prev,
      activityLogs: [...prev.activityLogs, log],
      ...(session ? { sessions: [...prev.sessions, session] } : {}),
    }))
    // Fire-and-forget DB writes
    void db.activityLogs.add(log).catch(err => console.error('Failed to save activity log:', err))
    if (session) {
      void db.sessions.put(session).catch(err => console.error('Failed to save session:', err))
      const subjectName = subjectsMap.get(activity.subjectId!)?.name ?? 'Unknown'
      syncSession(session, subjectName)
      void updateStreakDayForSession(session).catch(err => console.error('Failed to update streak:', err))
    }
    push({
      description: `Attended ${activity.name}`,
      undo: async () => {
        await db.activityLogs.delete(log.id)
        if (session) await db.sessions.delete(session.id)
        await loadData()
      },
      redo: async () => {
        await db.activityLogs.add(log)
        if (session) await db.sessions.put(session)
        await loadData()
      },
    })
  }

  async function saveRoutine(updated: Routine) {
    await db.routines.put(updated)
    await loadData()
  }

  async function deleteRoutine(routine: Routine) {
    await db.routines.update(routine.id, { deletedAt: isoNow(), updatedAt: isoNow() })
    await loadData()
  }

  async function saveActivity(updated: Activity) {
    await db.activities.put(updated)
    await loadData()
  }

  async function deleteActivity(activity: Activity) {
    await db.activities.update(activity.id, { deletedAt: isoNow(), updatedAt: isoNow() })
    await loadData()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setTab('today')}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors',
              tab === 'today'
                ? 'border-b-2 border-primary-500 text-primary-600 dark:text-primary-400'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
            )}
          >Today</button>
          <button
            onClick={() => setTab('plan')}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors',
              tab === 'plan'
                ? 'border-b-2 border-primary-500 text-primary-600 dark:text-primary-400'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
            )}
          >Weekly Plan</button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAddRoutineOpen(true)}>+ Routine</Button>
          <Button size="sm" variant="secondary" onClick={() => setAddActivityOpen(true)}>+ Activity</Button>
        </div>
      </div>

      {tab === 'today' && (
        <div className="space-y-3">
          {todaysActivities.length === 0 && todaysRoutines.length === 0 && (
            <EmptyState
              title="Nothing scheduled"
              description="Add a routine or activity to start tracking today."
              action={
                <div className="flex gap-2 justify-center">
                  <Button size="sm" onClick={() => setAddRoutineOpen(true)}>Add Routine</Button>
                  <Button size="sm" variant="secondary" onClick={() => setAddActivityOpen(true)}>Add Activity</Button>
                </div>
              }
            />
          )}

          {catchUpItems.map(item => (
            <Card key={`${item.id}:${item.date}`} className="border-l-4 border-l-amber-500">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: item.color }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    Did you complete <span className="font-semibold">{item.name}</span> on{' '}
                    {format(new Date(item.date), 'EEE, d MMM')}?
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => confirmCatchUp(item)}
                  >
                    Yes
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => dismissCatchUp(item.id, item.date)}
                  >
                    No
                  </Button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                If you tap <em>No</em>, we'll ask again next time this day comes around.
              </p>
            </Card>
          ))}
          {todaysActivities.length > 0 && (
            <div data-section="activities">
              <div className="mb-2 mt-2 flex items-center gap-2">
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  Activities
                </span>
                <span className="text-xs text-slate-500">events you attend (no study time)</span>
              </div>
              {todaysActivities.map(activity => (
                <ActivityCard
                  key={activity.id}
                  activity={activity}
                  subjectName={activity.subjectId ? subjectsMap.get(activity.subjectId)?.name ?? null : null}
                  existingLog={getActivityLogForToday(activity.id)}
                  isExpanded={expandedId === activity.id}
                  onToggleExpand={() => setExpandedId(expandedId === activity.id ? null : activity.id)}
                  onAttended={() => attendActivity(activity)}
                  onSkip={() => skipActivity(activity)}
                  onEdit={() => setActivityEditing(activity)}
                  onUndo={() => {
                    const log = getActivityLogForToday(activity.id)
                    if (log) {
                        db.activityLogs.delete(log.id).then(() => {
                            db.sessions.where({ note: `Activity: ${activity.name}` }).delete()
                            loadData()
                        })
                    }
                  }}
                />
              ))}
            </div>
          )}

          {todaysRoutines.filter(r => !getRoutineLogForToday(r.id)?.completed).length > 0 && (
            <div data-section="study-blocks">
              <div className="mb-2 mt-4 flex items-center gap-2">
                <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                  Study blocks
                </span>
                <span className="text-xs text-slate-500">study time you log toward routines</span>
              </div>
              {todaysRoutines
                .filter(r => !getRoutineLogForToday(r.id)?.completed)
                .map(routine => (
                  <RoutineCard
                    key={routine.id}
                    routine={routine}
                    subjectName={subjectsMap.get(routine.subjectId)?.name ?? 'Unknown'}
                    existingLog={getRoutineLogForToday(routine.id)}
                    targetMins={routine.dayMinutes[dow] ?? 0}
                    isLoggingCustom={logCustomFor === routine.id}
                    customMinutes={customMinutes}
                    onCustomMinutesChange={setCustomMinutes}
                    onStartCustom={() => { setLogCustomFor(routine.id); setCustomMinutes('') }}
                    onCancelCustom={() => { setLogCustomFor(null); setCustomMinutes('') }}
                    onSaveCustom={() => { void logCustom(routine, Number(customMinutes)); setLogCustomFor(null); setCustomMinutes('') }}
                    onMarkDone={() => markDone(routine)}
                    onSkip={() => skipRoutine(routine)}
                    isExpanded={expandedId === routine.id}
                    onToggleExpand={() => setExpandedId(expandedId === routine.id ? null : routine.id)}
                  />
                ))}
            </div>
          )}

          {todaysRoutines.some(r => getRoutineLogForToday(r.id)?.completed) && (
            <div data-section="completed-old" className="mt-4">
              <Collapsible id="completed-routines" title={`Completed today (${todaysRoutines.filter(r => getRoutineLogForToday(r.id)?.completed).length})`} defaultOpen={false}>
                {todaysRoutines
                  .filter(r => getRoutineLogForToday(r.id)?.completed)
                  .map(routine => (
                    <RoutineCard
                      key={routine.id}
                      routine={routine}
                      subjectName={subjectsMap.get(routine.subjectId)?.name ?? 'Unknown'}
                      existingLog={getRoutineLogForToday(routine.id)}
                      targetMins={routine.dayMinutes[dow] ?? 0}
                      isLoggingCustom={false}
                      customMinutes=""
                      onCustomMinutesChange={() => {}}
                      onStartCustom={() => {}}
                      onCancelCustom={() => {}}
                      onSaveCustom={() => {}}
                      onMarkDone={() => {}}
                      onSkip={() => {}}
                      isExpanded={expandedId === routine.id}
                      onToggleExpand={() => setExpandedId(expandedId === routine.id ? null : routine.id)}
                    />
                  ))}
              </Collapsible>
            </div>
          )}
        </div>
      )}

      {tab === 'plan' && (
        <WeeklyPlanGrid
          routines={routines}
          activities={activities}
          onEditRoutine={r => setRoutineEditing(r)}
          onEditActivity={a => setActivityEditing(a)}
          onEditCell={(itemId, d, mins, isActivity) => setCellEditing({ itemId, dow: d, minutes: String(mins), isActivity })}
        />
      )}

      {routineEditing && (
        <RoutineEditModal
          routine={routineEditing}
          subjects={subjects}
          projects={projects}
          onClose={() => setRoutineEditing(null)}
          onSave={async r => { await saveRoutine(r); setRoutineEditing(null) }}
          onDelete={async r => { await deleteRoutine(r); setRoutineEditing(null) }}
        />
      )}

      {activityEditing && (
        <ActivityEditModal
          activity={activityEditing}
          subjects={subjects}
          onClose={() => setActivityEditing(null)}
          onSave={async a => { await saveActivity(a); setActivityEditing(null) }}
          onDelete={async a => { await deleteActivity(a); setActivityEditing(null) }}
        />
      )}

      {cellEditing && (() => {
        const routine = !cellEditing.isActivity ? routines.find(r => r.id === cellEditing.itemId) : null
        const activity = cellEditing.isActivity ? activities.find(a => a.id === cellEditing.itemId) : null
        const next = routine
          ? { ...routine, dayMinutes: { ...routine.dayMinutes, [cellEditing.dow]: Number(cellEditing.minutes) || 0 }, updatedAt: isoNow() } as Routine
          : activity
            ? { ...activity, dayMinutes: { ...activity.dayMinutes, [cellEditing.dow]: Number(cellEditing.minutes) || 0 }, updatedAt: isoNow() } as Activity
            : null
        if (!next) return null
        const currentMins = next.dayMinutes[cellEditing.dow] ?? 0
        return (
          <CellEditModal
            dayLabel={DAY_LABELS[cellEditing.dow]}
            currentMinutes={currentMins}
            value={cellEditing.minutes}
            onChange={v => setCellEditing({ ...cellEditing, minutes: v })}
            onCancel={() => setCellEditing(null)}
            onSave={async () => {
              if (routine) await saveRoutine(next as Routine)
              else if (activity) await saveActivity(next as Activity)
              setCellEditing(null)
            }}
            onClear={async () => {
              const cleared = routine
                ? { ...routine, dayMinutes: { ...routine.dayMinutes, [cellEditing.dow]: 0 }, updatedAt: isoNow() } as Routine
                : { ...activity!, dayMinutes: { ...activity!.dayMinutes, [cellEditing.dow]: 0 }, updatedAt: isoNow() } as Activity
              if (routine) await saveRoutine(cleared as Routine)
              else if (activity) await saveActivity(cleared as Activity)
              setCellEditing(null)
            }}
          />
        )
      })()}

      {addRoutineOpen && (
        <RoutineEditModal
          routine={null}
          subjects={subjects}
          projects={projects}
          onClose={() => setAddRoutineOpen(false)}
          onSave={async r => { await saveRoutine(r); setAddRoutineOpen(false) }}
          onDelete={null}
        />
      )}

      {addActivityOpen && (
        <ActivityEditModal
          activity={null}
          subjects={subjects}
          onClose={() => setAddActivityOpen(false)}
          onSave={async a => { await saveActivity(a); setAddActivityOpen(false) }}
          onDelete={null}
        />
      )}
    </div>
  )
}

// =============================================================================
// Routine card (Today tab)
// =============================================================================
function RoutineCard(props: {
  routine: Routine
  subjectName: string
  existingLog?: RoutineLog
  targetMins: number
  isLoggingCustom: boolean
  customMinutes: string
  onCustomMinutesChange: (v: string) => void
  onStartCustom: () => void
  onCancelCustom: () => void
  onSaveCustom: () => void
  onMarkDone: () => void
  onSkip: () => void
  isExpanded: boolean
  onToggleExpand: () => void
}) {
  const {
    routine, subjectName, existingLog, targetMins,
    isLoggingCustom, customMinutes,
    onCustomMinutesChange, onStartCustom, onCancelCustom, onSaveCustom,
    onMarkDone, onSkip,
    isExpanded, onToggleExpand,
  } = props
  const loggedMins = existingLog?.actualMinutes ?? 0
  const pct = targetMins > 0 ? Math.min(100, Math.round((loggedMins / targetMins) * 100)) : 0

  if (existingLog?.completed) {
    const doneTime = existingLog.createdAt ? format(new Date(existingLog.createdAt), 'h:mm a') : format(new Date(), 'h:mm a')
    if (!isExpanded) {
      return (
        <button
          type="button"
          onClick={onToggleExpand}
          className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 flex items-center gap-3 opacity-70 hover:opacity-100 transition-opacity"
        >
          <span className="text-green-600">✓</span>
          <span className="font-medium line-through text-slate-700 dark:text-slate-200">{routine.name}</span>
          <span className="text-slate-400 text-sm">·</span>
          <span className="text-sm text-slate-500 dark:text-slate-400">{loggedMins}m</span>
          <span className="text-slate-400 text-sm">·</span>
          <span className="text-sm text-slate-500 dark:text-slate-400">Done {doneTime}</span>
        </button>
      )
    }
    return (
      <Card>
        <div className="flex items-center gap-3 opacity-70">
          <span className="text-green-600">✓</span>
          <span className="font-medium line-through text-slate-700 dark:text-slate-200">{routine.name}</span>
          <span className="text-slate-400">·</span>
          <span className="text-sm">{loggedMins}m</span>
          <span className="text-slate-400">·</span>
          <span className="text-sm">Done {doneTime}</span>
          <button onClick={onToggleExpand} className="ml-auto text-xs text-slate-500 hover:underline">Collapse</button>
        </div>
        <div className="mt-3 text-sm text-slate-600 dark:text-slate-400">{subjectName} · {dayPatternLabel(routine.dayMinutes)}</div>
      </Card>
    )
  }

  if (existingLog && !existingLog.completed) {
    if (!isExpanded) {
      return (
        <button
          type="button"
          onClick={onToggleExpand}
          className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 flex items-center gap-3 opacity-70 hover:opacity-100 transition-opacity"
        >
          <span className="text-amber-500">—</span>
          <span className="font-medium text-slate-700 dark:text-slate-200">{routine.name}</span>
          <span className="text-slate-400 text-sm">·</span>
          <span className="text-sm text-amber-600 dark:text-amber-400">Skipped</span>
        </button>
      )
    }
    return (
      <Card>
        <div className="flex items-center gap-3 opacity-70">
          <span className="text-amber-500">—</span>
          <span className="font-medium text-slate-700 dark:text-slate-200">{routine.name}</span>
          <span className="text-slate-400">·</span>
          <span className="text-sm text-amber-600 dark:text-amber-400">Skipped</span>
          <button onClick={onToggleExpand} className="ml-auto text-xs text-slate-500 hover:underline">Collapse</button>
        </div>
        <div className="mt-3 text-sm text-slate-600 dark:text-slate-400">{subjectName} · {dayPatternLabel(routine.dayMinutes)}</div>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: routine.color }} />
            <CardTitle>{routine.name}</CardTitle>
          </div>
          <span className="text-sm text-slate-500 dark:text-slate-400">{targetMins}m target</span>
        </div>
      </CardHeader>
      <div className="text-sm text-slate-600 dark:text-slate-400 mb-2">
        {subjectName} · {dayPatternLabel(routine.dayMinutes)}
      </div>
      {loggedMins > 0 && (
        <div className="mb-3">
          <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: routine.color }} />
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{loggedMins}m / {targetMins}m logged</div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onMarkDone}>✓ Mark Done</Button>
        {isLoggingCustom ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              type="number"
              min="1"
              value={customMinutes}
              onChange={e => onCustomMinutesChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onSaveCustom(); if (e.key === 'Escape') onCancelCustom() }}
              className="w-20 px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
              placeholder="mins"
            />
            <Button size="sm" onClick={onSaveCustom}>Save</Button>
            <Button size="sm" variant="secondary" onClick={onCancelCustom}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={onStartCustom}>Log Custom</Button>
        )}
        <Button size="sm" variant="danger" onClick={onSkip}>Skip</Button>
      </div>
    </Card>
  )
}

// =============================================================================
// Activity card (Today tab)
// =============================================================================
function ActivityCard(props: {
  activity: Activity
  subjectName: string | null
  existingLog?: ActivityLog
  onAttended: () => void
  onSkip: () => void
  onEdit: () => void
  onUndo: () => void
  isExpanded: boolean
  onToggleExpand: () => void
}) {
  const { activity, subjectName, existingLog, onAttended, onSkip, onEdit, onUndo, isExpanded, onToggleExpand } = props
  const mins = activity.dayMinutes[new Date().getDay() as DayOfWeek] ?? activity.duration ?? 0
  if (existingLog) {
    if (existingLog.status === 'completed') {
      const doneTime = existingLog.createdAt ? format(new Date(existingLog.createdAt), 'h:mm a') : format(new Date(), 'h:mm a')
      if (!isExpanded) {
        return (
          <button
            type="button"
            onClick={onToggleExpand}
            className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 flex items-center gap-3 opacity-70 hover:opacity-100 transition-opacity"
          >
            <span className="text-green-600">✓</span>
            <span className="font-medium line-through text-slate-700 dark:text-slate-200">{activity.name}</span>
            <span className="text-slate-400 text-sm">·</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">{mins}m</span>
            <span className="text-slate-400 text-sm">·</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">Done {doneTime}</span>
          </button>
        )
      }
      return (
        <Card>
          <div className="flex items-center gap-3 opacity-70">
            <span className="text-green-600">✓</span>
            <span className="font-medium line-through text-slate-700 dark:text-slate-200">{activity.name}</span>
            <span className="text-slate-400">·</span>
            <span className="text-sm">{mins}m</span>
            <span className="text-slate-400">·</span>
            <span className="text-sm">Done {doneTime}</span>
            <button onClick={onUndo} className="ml-auto rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">Mark as undone</button>
            <button onClick={onToggleExpand} className="text-xs text-slate-500 hover:underline">Collapse</button>
          </div>
          {subjectName && <div className="mt-3 text-sm text-slate-600 dark:text-slate-400">{subjectName}</div>}
          {activity.scheduledTime && (
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">{formatTime12h(activity.scheduledTime)}</div>
          )}
        </Card>
      )
    }
    if (existingLog.status === 'skipped') {
      if (!isExpanded) {
        return (
          <button
            type="button"
            onClick={onToggleExpand}
            className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 flex items-center gap-3 opacity-70 hover:opacity-100 transition-opacity"
          >
            <span className="text-amber-500">—</span>
            <span className="font-medium text-slate-700 dark:text-slate-200">{activity.name}</span>
            <span className="text-slate-400 text-sm">·</span>
            <span className="text-sm text-amber-600 dark:text-amber-400">Skipped</span>
          </button>
        )
      }
      return (
        <Card>
          <div className="flex items-center gap-3 opacity-70">
            <span className="text-amber-500">—</span>
            <span className="font-medium text-slate-700 dark:text-slate-200">{activity.name}</span>
            <span className="text-slate-400">·</span>
            <span className="text-sm text-amber-600 dark:text-amber-400">Skipped</span>
            <button onClick={onUndo} className="ml-auto rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">Mark as undone</button>
            <button onClick={onToggleExpand} className="text-xs text-slate-500 hover:underline">Collapse</button>
          </div>
          {subjectName && <div className="mt-3 text-sm text-slate-600 dark:text-slate-400">{subjectName}</div>}
        </Card>
      )
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: activity.color }} />
            <CardTitle>{activity.name}</CardTitle>
          </div>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {mins}m{activity.scheduledTime ? ` · ${formatTime12h(activity.scheduledTime)}` : ''}
          </span>
        </div>
      </CardHeader>
      {activity.scheduledTime && (
        <div className="text-sm text-slate-600 dark:text-slate-400 mb-3">{timeUntil(activity.scheduledTime)}</div>
      )}
      {subjectName && (
        <div className="text-sm text-slate-600 dark:text-slate-400 mb-2">{subjectName}</div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onAttended}>✓ Attended</Button>
        <Button size="sm" variant="danger" onClick={onSkip}>Skipped</Button>
        <Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button>
      </div>
    </Card>
  )
}

// =============================================================================
// Weekly Plan grid
// =============================================================================
function WeeklyPlanGrid(props: {
  routines: Routine[]
  activities: Activity[]
  onEditRoutine: (r: Routine) => void
  onEditActivity: (a: Activity) => void
  onEditCell: (itemId: string, dow: DayOfWeek, minutes: number, isActivity: boolean) => void
}) {
  const { routines, activities, onEditRoutine, onEditActivity, onEditCell } = props

  if (routines.length === 0 && activities.length === 0) {
    return <EmptyState title="No routines or activities yet" description="Add one using the buttons above to start planning your week." />
  }

  const maxRoutineMin = routines.reduce((m, r) => Math.max(m, ...Object.values(r.dayMinutes).map(v => v ?? 0)), 0)
  const maxActivityMin = activities.reduce((m, a) => Math.max(m, ...Object.values(a.dayMinutes).map(v => v ?? 0)), 0)

  function blockHeight(mins: number, max: number): string {
    if (mins <= 0 || max <= 0) return '24px'
    const ratio = mins / max
    return `${Math.max(24, Math.round(ratio * 72))}px`
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[640px]" style={{ gridTemplateColumns: '200px repeat(7, minmax(70px, 1fr))' }}>
        <div />
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-xs font-semibold text-slate-600 dark:text-slate-300 py-2 border-b border-slate-200 dark:border-slate-700">
            {d}
          </div>
        ))}
        {routines.map(r => (
          <RoutineGridRow
            key={r.id}
            routine={r}
            maxMinutes={maxRoutineMin}
            onEditRoutine={onEditRoutine}
            onEditCell={onEditCell}
            blockHeight={blockHeight}
          />
        ))}
        {activities.map(a => (
          <ActivityGridRow
            key={a.id}
            activity={a}
            maxMinutes={maxActivityMin}
            onEditActivity={onEditActivity}
            onEditCell={onEditCell}
            blockHeight={blockHeight}
          />
        ))}
      </div>
    </div>
  )
}

function RoutineGridRow(props: {
  routine: Routine
  maxMinutes: number
  onEditRoutine: (r: Routine) => void
  onEditCell: (id: string, dow: DayOfWeek, m: number, isActivity: boolean) => void
  blockHeight: (mins: number, max: number) => string
}) {
  const { routine, maxMinutes, onEditRoutine, onEditCell, blockHeight } = props
  return (
    <>
      <button
        onClick={() => onEditRoutine(routine)}
        className="text-left py-2 pr-3 text-sm font-medium text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        <div className="flex items-center gap-2 truncate">
          <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: routine.color }} />
          <span className="truncate">{routine.name}</span>
        </div>
      </button>
      {WEEKDAYS.map((_, i) => {
        const dow = i as DayOfWeek
        const mins = routine.dayMinutes[dow] ?? 0
        return (
          <div key={i} className="border-b border-slate-100 dark:border-slate-800 p-1">
            {mins > 0 ? (
              <button
                onClick={() => onEditCell(routine.id, dow, mins, false)}
                className="w-full rounded text-xs text-white font-medium flex items-center justify-center transition-opacity hover:opacity-80"
                style={{ backgroundColor: routine.color, height: blockHeight(mins, maxMinutes) }}
                title={`${mins}m on ${DAY_LABELS[dow]}`}
              >
                {mins}m
              </button>
            ) : (
              <button
                onClick={() => onEditCell(routine.id, dow, 30, false)}
                className="w-full text-xs text-slate-400 hover:text-primary-500 flex items-center justify-center rounded border border-dashed border-transparent hover:border-primary-300 transition-colors"
                style={{ height: '24px' }}
                title={`Add ${DAY_LABELS[dow]}`}
              >+</button>
            )}
          </div>
        )
      })}
    </>
  )
}

function ActivityGridRow(props: {
  activity: Activity
  maxMinutes: number
  onEditActivity: (a: Activity) => void
  onEditCell: (id: string, dow: DayOfWeek, m: number, isActivity: boolean) => void
  blockHeight: (mins: number, max: number) => string
}) {
  const { activity, maxMinutes, onEditActivity, onEditCell, blockHeight } = props
  return (
    <>
      <button
        onClick={() => onEditActivity(activity)}
        className="text-left py-2 pr-3 text-sm text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        <div className="flex items-center gap-2 truncate">
          <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: activity.color }} />
          <span className="truncate">{activity.name}{activity.scheduledTime ? ` (${formatTime12h(activity.scheduledTime)})` : ''}</span>
        </div>
      </button>
      {WEEKDAYS.map((_, i) => {
        const dow = i as DayOfWeek
        const mins = activity.dayMinutes[dow] ?? 0
        return (
          <div key={i} className="border-b border-slate-100 dark:border-slate-800 p-1">
            {mins > 0 ? (
              <button
                onClick={() => onEditCell(activity.id, dow, mins, true)}
                className="w-full rounded text-xs text-white font-medium flex items-center justify-center transition-opacity hover:opacity-80"
                style={{ backgroundColor: activity.color, height: blockHeight(mins, maxMinutes) }}
                title={`${mins}m on ${DAY_LABELS[dow]}`}
              >
                {activity.scheduledTime ? formatTime12h(activity.scheduledTime) : `${mins}m`}
              </button>
            ) : (
              <button
                onClick={() => onEditCell(activity.id, dow, activity.duration ?? 60, true)}
                className="w-full text-xs text-slate-400 hover:text-primary-500 flex items-center justify-center rounded border border-dashed border-transparent hover:border-primary-300 transition-colors"
                style={{ height: '24px' }}
                title={`Add ${DAY_LABELS[dow]}`}
              >+</button>
            )}
          </div>
        )
      })}
    </>
  )
}

// =============================================================================
// Modals
// =============================================================================
function CellEditModal(props: {
  dayLabel: string
  currentMinutes: number
  value: string
  onChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
  onClear: () => void
}) {
  const { dayLabel, value, currentMinutes, onChange, onSave, onCancel, onClear } = props
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-1 text-slate-800 dark:text-slate-100">Edit minutes</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Currently {currentMinutes}m on {dayLabel}</p>
        <input
          autoFocus
          type="number"
          min="0"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel() }}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 mb-4"
        />
        <div className="flex justify-between gap-2">
          <Button size="sm" variant="danger" onClick={onClear}>Clear</Button>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button size="sm" onClick={onSave}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RoutineEditModal(props: {
  routine: Routine | null
  subjects: Array<{ id: string; name: string }>
  projects: Project[]
  onClose: () => void
  onSave: (r: Routine) => Promise<void>
  onDelete: ((r: Routine) => Promise<void>) | null
}) {
  const { routine, subjects, projects, onClose, onSave, onDelete } = props
  const [name, setName] = useState(routine?.name ?? '')
  const [subjectId, setSubjectId] = useState(routine?.subjectId ?? subjects[0]?.id ?? '')
  const [projectId, setProjectId] = useState<string>(routine?.projectId ?? '')
  const [color, setColor] = useState(routine?.color ?? DEFAULT_COLORS[0])
  const [dayMinutes, setDayMinutes] = useState<Partial<Record<DayOfWeek, number>>>(routine?.dayMinutes ?? {})
  const [scheduledTime, setScheduledTime] = useState(routine?.scheduledTime ?? '')
  const [notes, setNotes] = useState(routine?.notes ?? '')

  const subjectProjects = useMemo(() => projects.filter(p => p.subjectId === subjectId), [projects, subjectId])

  function setDay(dow: DayOfWeek, mins: number) {
    const next = { ...dayMinutes }
    if (mins <= 0) delete next[dow]
    else next[dow] = mins
    setDayMinutes(next)
  }

  async function handleSave() {
    const now = isoNow()
    const next: Routine = {
      id: routine?.id ?? uuid(),
      name: name.trim() || 'Untitled Routine',
      subjectId,
      projectId: projectId || null,
      dayMinutes,
      color,
      scheduledTime: scheduledTime || undefined,
      notes: notes || undefined,
      createdAt: routine?.createdAt ?? now,
      updatedAt: now,
    }
    await onSave(next)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4 text-slate-800 dark:text-slate-100">{routine ? 'Edit Routine' : 'New Routine'}</h3>
        <div className="space-y-3">
          <Field label="Name">
            <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Subject">
            <select value={subjectId} onChange={e => { setSubjectId(e.target.value); setProjectId('') }} className={inputCls}>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Project (optional)">
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className={inputCls}>
              <option value="">None</option>
              {subjectProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Color">
            <ColorPicker value={color} onChange={setColor} />
          </Field>
          <Field label="Schedule (days & minutes)">
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d, i) => {
                const dow = i as DayOfWeek
                const active = (dayMinutes[dow] ?? 0) > 0
                return (
                  <div key={d} className="text-center">
                    <button
                      type="button"
                      onClick={() => setDay(dow, active ? 0 : 30)}
                      className={cn('w-full text-xs font-medium py-1 rounded', active ? 'bg-primary-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300')}
                    >{d}</button>
                    {active && (
                      <input
                        type="number"
                        min="5"
                        step="5"
                        value={dayMinutes[dow] ?? 30}
                        onChange={e => setDay(dow, Number(e.target.value))}
                        className="w-full mt-1 px-1 py-0.5 text-xs border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </Field>
          <Field label="Scheduled time (optional)">
            <input type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Notes">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputCls} />
          </Field>
        </div>
        <div className="flex justify-between mt-6">
          <div>
            {onDelete && routine && (
              <Button size="sm" variant="danger" onClick={() => onDelete(routine)}>Delete</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActivityEditModal(props: {
  activity: Activity | null
  subjects: Array<{ id: string; name: string }>
  onClose: () => void
  onSave: (a: Activity) => Promise<void>
  onDelete: ((a: Activity) => Promise<void>) | null
}) {
  const { activity, subjects, onClose, onSave, onDelete } = props
  const [name, setName] = useState(activity?.name ?? '')
  const [subjectId, setSubjectId] = useState<string>(activity?.subjectId ?? '')
  const [color, setColor] = useState(activity?.color ?? DEFAULT_COLORS[1])
  const [dayMinutes, setDayMinutes] = useState<Partial<Record<DayOfWeek, number>>>(activity?.dayMinutes ?? {})
  const [scheduledTime, setScheduledTime] = useState(activity?.scheduledTime ?? '')
  const [notes, setNotes] = useState(activity?.notes ?? '')
  const [duration, setDuration] = useState(activity?.duration ?? 60)
  const [createsSession, setCreatesSession] = useState(activity?.createsSession ?? false)

  function setDay(dow: DayOfWeek, active: boolean) {
    const next = { ...dayMinutes }
    if (active) next[dow] = duration
    else delete next[dow]
    setDayMinutes(next)
  }

  function updateDuration(d: number) {
    setDuration(d)
    const next: Partial<Record<DayOfWeek, number>> = {}
    for (const k of Object.keys(dayMinutes) as unknown as DayOfWeek[]) next[k] = d
    setDayMinutes(next)
  }

  async function handleSave() {
    const now = isoNow()
    const next: Activity = {
      id: activity?.id ?? uuid(),
      name: name.trim() || 'Untitled Activity',
      subjectId: subjectId || null,
      dayMinutes,
      duration,
      createsSession,
      scheduledTime: scheduledTime || undefined,
      notes: notes || undefined,
      color,
      createdAt: activity?.createdAt ?? now,
      updatedAt: now,
    }
    await onSave(next)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4 text-slate-800 dark:text-slate-100">{activity ? 'Edit Activity' : 'New Activity'}</h3>
        <div className="space-y-3">
          <Field label="Name">
            <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="e.g. Japanese Tutoring" />
          </Field>
          <Field label="Subject (optional)">
            <select value={subjectId} onChange={e => setSubjectId(e.target.value)} className={inputCls}>
              <option value="">None</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Scheduled time">
            <input type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Duration (minutes)">
            <input type="number" min="5" step="5" value={duration} onChange={e => updateDuration(Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Schedule (days)">
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d, i) => {
                const dow = i as DayOfWeek
                const active = (dayMinutes[dow] ?? 0) > 0
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDay(dow, !active)}
                    className={cn('text-xs font-medium py-1 rounded', active ? 'bg-primary-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300')}
                  >{d}</button>
                )
              })}
            </div>
          </Field>
          <Field label="Color">
            <ColorPicker value={color} onChange={setColor} />
          </Field>
          <Field label="Notes">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={createsSession}
              onChange={e => setCreatesSession(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            <span>Create study session when marked Attended</span>
          </label>
        </div>
        <div className="flex justify-between mt-6">
          <div>
            {onDelete && activity && (
              <Button size="sm" variant="danger" onClick={() => onDelete(activity)}>Delete</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Shared helpers
// =============================================================================
const inputCls = 'w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100'

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{props.label}</span>
      {props.children}
    </label>
  )
}

export default SchedulePage