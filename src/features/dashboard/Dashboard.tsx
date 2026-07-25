import { TodaysRoutinesList } from '../../components/widgets/TodaysRoutinesList'
import { ActivityConfirmationCard } from '../../components/widgets/ActivityConfirmationCard'
import { SubjectBreakdown } from '../../components/widgets/SubjectBreakdown'
import { formatTotalToday, getLiveTimerSeconds, getLiveTimerSubjectId, getTotalTodayMinutes, isTimerActive } from '../../lib/timer-utils'
import { useEffect, useMemo, useState } from 'react'
import { addMonths, format, subDays, subMonths } from 'date-fns'
import { v4 as uuid } from 'uuid'
import { PomodoroTimer } from '../../components/widgets/PomodoroTimer'
import { useData } from '../../app/providers'
import { useUndo } from '../../lib/use-undo'
import { Button } from '../../components/ui/Button'
import { Card, CardHeader, CardTitle } from '../../components/ui/Card'
import { PageSpinner } from '../../components/ui/Spinner'
import { NumberInput } from '../../components/ui/NumberInput'
import { Modal } from '../../components/ui/Modal'
import { HoverCard } from '../../components/ui/HoverCard'
import { ContextMenu } from '../../components/ui/ContextMenu'
import { useSwipe } from '../../lib/use-swipe'
import { cn, formatMinutes, getSessionScope, getSubjectPathLabel, isoNow, toLocalDateString } from '../../lib/utils'
import { loadSettings } from '../../lib/settings-store'
import { useStreak } from '../../lib/use-streak'
import { db } from '../../db/app-db'
import { updateRoutineLogsForSession, revertRoutineLogsForSession, updateStreakDayForSession, revertStreakDayForSession } from '../../lib/routine-tracker'
import { getDueCount } from '../../lib/fsrs-scheduler'
import { useSessionSync } from '../../lib/use-session-sync'
import type { Session, DayOfWeek, RoutineLog } from '../../domain/types'
import { Link, useNavigate } from 'react-router-dom'
import { useDashboardWidgets, DASHBOARD_WIDGETS_METADATA, DEFAULT_CONFIGS, DEFAULT_WIDGET_IDS } from '../../lib/use-dashboard-widgets'
import { SessionDetailsModal } from '../../components/ui/SessionDetailsModal'
import { DashboardWidget } from '../../components/widgets/DashboardWidget'

const STREAK_MILESTONES = [7, 14, 21, 30, 66, 100] as const
const CELEBRATION_KEY = 'momentum-last-celebration'
function copySessionInfo(session: Session & { subjectName: string }) {
  const time = format(new Date(session.startAt), 'h:mm a')
  const src = session.source === 'timer' ? 'timer' : session.source === 'pomodoro' ? 'pomodoro' : session.source === 'quickLog' ? 'quick log' : session.source === 'autoRoutine' ? 'routine' : 'manual'
  navigator.clipboard.writeText(`${session.subjectName} · ${formatMinutes(session.durationMinutes)} · ${time} · ${src}`).catch(() => {})
}
function SessionRow({
  session, project, menuSessionId, setMenuSessionId,
  setEditLog, setEditDuration, setEditDate, setEditSubjectId,
  deleteSession,
  selected, onToggleSelect, selectionMode,
  setViewSession, setViewModalOpen,
}: {
  session: Session & { subjectName: string; subjectColor: string }
  project: { name: string } | undefined
  menuSessionId: string | null
  setMenuSessionId: (id: string | null) => void
  setEditLog: (s: Session | null) => void
  setEditDuration: (n: number) => void
  setEditDate: (s: string) => void
  setEditSubjectId: (s: string) => void
  deleteSession: (id: string) => void
  selected: boolean
  onToggleSelect: (id: string) => void
  selectionMode: boolean
  setViewSession: (s: Session | null) => void
  setViewModalOpen: (open: boolean) => void
}) {
  const swipe = useSwipe({
    onSwipeLeft: () => deleteSession(session.id),
    onSwipeRight: () => {
      setViewSession(session)
      setViewModalOpen(true)
    },
  })
  const srcLabel = session.source === 'timer' ? 'timer' : session.source === 'pomodoro' ? 'pomodoro' : session.source === 'quickLog' ? 'quick log' : session.source === 'autoRoutine' ? 'routine' : 'manual'
  return (
    <ContextMenu items={[
      { label: 'View', action: () => { setViewSession(session); setViewModalOpen(true) } },
      { label: 'Edit', action: () => { setEditLog(session); setEditDuration(session.durationMinutes); setEditDate(toLocalDateString(session.startAt)); setEditSubjectId(session.subjectId) } },
      { label: 'Copy', action: () => copySessionInfo(session) },
      { label: 'Delete', action: () => deleteSession(session.id), danger: true },
    ]}>
      <li
        key={session.id}
        className="flex items-center justify-between py-2"
        onDoubleClick={() => {
          setViewSession(session)
          setViewModalOpen(true)
        }}
        {...swipe}
      >
        {selectionMode && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(session.id)}
            className="h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-primary-600 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-700"
            aria-label={`Select session ${session.subjectName}`}
          />
        )}
        <HoverCard
          content={
            <div className="space-y-1 text-sm">
              <div className="font-medium">{session.subjectName}</div>
              {project && <div className="text-slate-500">{project.name}</div>}
              <div className="text-slate-500">{session.noTime ? 'no time' : format(new Date(session.startAt), 'h:mm a')} · {formatMinutes(session.durationMinutes)}</div>
              <div className="text-slate-500">Source: {srcLabel}</div>
              {session.note && <div className="text-slate-400 italic">{session.note}</div>}
            </div>
          }
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: session.subjectColor }} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{session.subjectName}{project && <span className="text-slate-500"> · {project.name}</span>}</div>
              <div className="text-xs text-slate-500">{session.noTime ? '(no time)' : format(new Date(session.startAt), 'h:mm a')}{session.source === 'timer' ? ' ⏱' : session.source === 'pomodoro' ? ' 🍅' : ' ✏️'}</div>
            </div>
          </div>
        </HoverCard>
        <div className="flex items-center gap-2">
          <div className="text-sm text-slate-600">{formatMinutes(session.durationMinutes)}</div>
          <div className="relative">
            <button type="button" aria-label="More actions" onClick={() => setMenuSessionId(menuSessionId === session.id ? null : session.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700">
              <span className="block text-lg leading-none">⋯</span>
            </button>
            {menuSessionId === session.id && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenuSessionId(null)} />
                <div className="absolute right-0 z-30 mt-1 w-36 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700" onClick={() => { setEditLog(session); setEditDuration(session.durationMinutes); setEditDate(toLocalDateString(session.startAt)); setEditSubjectId(session.subjectId); setMenuSessionId(null) }}>
                    Edit time
                  </button>
                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700" onClick={() => { copySessionInfo(session); setMenuSessionId(null) }}>
                    Copy
                  </button>
                  <button type="button" className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-slate-100 dark:hover:bg-slate-700" onClick={() => { deleteSession(session.id); setMenuSessionId(null) }}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </li>
    </ContextMenu>
  )
}

export default function Dashboard() {
  const { data, isLoading, loadData } = useData()
  const { syncSession, syncSessionDelete } = useSessionSync()
  const { push } = useUndo()
  const { visibleWidgets, setVisibleWidgets, widgetConfigs, setWidgetConfigs, setWidgetConfig, setWidgetSize, reorderWidgets } = useDashboardWidgets()
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [logModalOpen, setLogModalOpen] = useState(false)
  const [recentLimit, setRecentLimit] = useState(10)
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)
  const [showCelebration, setShowCelebration] = useState(false)
  const navigate = useNavigate()
  const [fabOpen, setFabOpen] = useState(false)
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [batchSubjectModalOpen, setBatchSubjectModalOpen] = useState(false)
  const [batchSubjectId, setBatchSubjectId] = useState('')
  const [showActivityConfirmation, setShowActivityConfirmation] = useState(true)

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  // Exclude soft-deleted sessions from streak / stats calculations.
  const academicSessions = useMemo(
    () => data.sessions.filter((s) => !s.deletedAt && getSessionScope(s, data.subjects, data.categories) === 'academic'),
    [data.sessions, data.subjects, data.categories]
  )
  const todayAcademicMinutes = useMemo(
    () => academicSessions
      .filter((s) => toLocalDateString(s.startAt) === todayStr)
      .reduce((sum, s) => sum + s.durationMinutes, 0),
    [academicSessions, todayStr]
  )
  const settings = useMemo(() => loadSettings(), [])

  const { streak, longestStreak } = useStreak(academicSessions)
  // Celebration: trigger once per day when the daily goal is met or a streak
  // milestone is reached today. Guarded by localStorage so it only fires once.
  useEffect(() => {
    try {
      const today = format(new Date(), 'yyyy-MM-dd')
      const last = localStorage.getItem(CELEBRATION_KEY)
      if (last === today) return
      const dailyMins = academicSessions
        .filter((s) => toLocalDateString(s.startAt) === today)
        .reduce((sum, s) => sum + s.durationMinutes, 0)
      const targetMet = dailyMins >= settings.dailyTargetMinutes
      const reachedMilestone = STREAK_MILESTONES.includes(
        streak as (typeof STREAK_MILESTONES)[number],
      )
      if (targetMet || reachedMilestone) {
        localStorage.setItem(CELEBRATION_KEY, today)
        setShowCelebration(true)
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streak, academicSessions, settings.dailyTargetMinutes])
  // Auto-hide celebration after 2 seconds
  useEffect(() => {
    if (!showCelebration) return
    const timer = setTimeout(() => setShowCelebration(false), 2000)
    return () => clearTimeout(timer)
  }, [showCelebration])


  const [calendarMonth, setCalendarMonth] = useState(new Date())
  const minutesByDay = useMemo(() => {
    const map: Record<string, number> = {}
    for (const s of academicSessions) {
      const day = toLocalDateString(s.startAt)
      map[day] = (map[day] ?? 0) + s.durationMinutes
    }
    return map
  }, [academicSessions])
  const calendarDays = useMemo(() => {
    const start = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
    const daysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate()
    const pad = start.getDay()
    return { daysInMonth, pad }
  }, [calendarMonth])
  const heatMax = useMemo(() => {
    const prefix = format(calendarMonth, 'yyyy-MM-')
    const vals = Object.entries(minutesByDay).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v)
    return Math.max(1, ...vals)
  }, [minutesByDay, calendarMonth])

  const LOG_FORM_KEY = 'dash-log-form'
  const persistedForm = (() => {
    try { return JSON.parse(sessionStorage.getItem(LOG_FORM_KEY) ?? 'null') } catch { return null }
  })()

  const [logSubjectId, setLogSubjectId] = useState(persistedForm?.subjectId ?? '')
  const [logProjectId, setLogProjectId] = useState(persistedForm?.projectId ?? '')
  const [logTaskId, setLogTaskId] = useState(persistedForm?.taskId ?? '')
  const [logDuration, setLogDuration] = useState(persistedForm?.duration ?? 30)
  const [logDate, setLogDate] = useState(persistedForm?.date ?? todayStr)
  const [logTime, setLogTime] = useState(persistedForm?.time ?? '')
  const [logNote, setLogNote] = useState(persistedForm?.note ?? '')
  const [logFocusTag, setLogFocusTag] = useState<Session['focusTag'] | null>(persistedForm?.focusTag ?? null)

  useEffect(() => {
    sessionStorage.setItem(LOG_FORM_KEY, JSON.stringify({
      subjectId: logSubjectId, projectId: logProjectId, taskId: logTaskId,
      duration: logDuration, date: logDate, time: logTime, note: logNote, focusTag: logFocusTag,
    }))
  }, [logSubjectId, logProjectId, logTaskId, logDuration, logDate, logTime, logNote, logFocusTag])

  // Close FAB on click outside or Escape
  useEffect(() => {
    if (!fabOpen) return
    function onClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.fab-container')) {
        setFabOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFabOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [fabOpen])
  async function handleLogTime() {
    if (logDuration < 1) {
      alert('Duration must be at least 1 minute')
      return
    }
    const note = logNote.trim()
    const [y, m, d] = logDate.split('-').map(Number)
    let startAt: string
    let endAt: string
    let noTime = false
    if (logTime) {
      const [h, mm] = logTime.split(':').map(Number)
      const start = new Date(y, m - 1, d, h, mm, 0, 0)
      startAt = start.toISOString()
      endAt = new Date(start.getTime() + logDuration * 60_000).toISOString()
    } else {
      startAt = new Date(y, m - 1, d, 12, 0, 0, 0).toISOString()
      endAt = new Date(y, m - 1, d, 12, logDuration, 0, 0).toISOString()
      noTime = true
    }
    if (!logSubjectId && !logProjectId) return
    const project = logProjectId ? data.projects.find((p) => p.id === logProjectId) : undefined
    const task = logTaskId ? data.assignments.find((a) => a.id === logTaskId) : undefined
    const actualSubjectId = project ? project.subjectId : logSubjectId
    if (!actualSubjectId) return
    const taskNote = note || (task ? `Task: ${task.title}` : undefined)
    const session: Session = {
      id: uuid(),
      subjectId: actualSubjectId,
      projectId: project?.id ?? null,
      assignmentId: task?.id ?? null,
      startAt,
      endAt,
      durationMinutes: logDuration,
      note: taskNote,
      focusTag: logFocusTag ?? undefined,
      source: 'quickLog' as const,
      createdAt: isoNow(),
      updatedAt: isoNow(),
      noTime
    }
    await db.sessions.add(session)
    const subjectName = data.subjects.find((s) => s.id === actualSubjectId)?.name ?? 'Unknown Subject'
    await updateRoutineLogsForSession(session)
    await updateStreakDayForSession(session)
    syncSession(session, subjectName)
    await loadData()
    let description = `Logged ${logDuration}m${project ? ` for ${project.name}` : ` study for ${subjectName}`}`
    if (task) description += ` (${task.title})`
    push({
      description,
      undo: async () => { await db.sessions.delete(session.id); await revertStreakDayForSession(session); await loadData() },
      redo: async () => { await db.sessions.add(session); await updateStreakDayForSession(session); await loadData() },
    })
    sessionStorage.removeItem(LOG_FORM_KEY)
    setLogSubjectId('')
    setLogProjectId('')
    setLogTaskId('')
    setLogTime('')
    setLogNote('')
    setLogFocusTag(null)
  }
  const [editLog, setEditLog] = useState<Session | null>(null)
  const [editDuration, setEditDuration] = useState(30)
  const [editDate, setEditDate] = useState(todayStr)
  const [viewSession, setViewSession] = useState<Session | null>(null)
  const [viewModalOpen, setViewModalOpen] = useState(false)
  const [liveTimerSeconds, setLiveTimerSeconds] = useState(0)
  const [liveTimerSubjectId, setLiveTimerSubjectId] = useState<string | null>(null)
  useEffect(() => {
    let interval: number | null = null
    let active = isTimerActive()
    const tick = () => {
      const nowActive = isTimerActive()
      setLiveTimerSeconds(nowActive ? getLiveTimerSeconds() : 0)
      setLiveTimerSubjectId(nowActive ? getLiveTimerSubjectId() : null)
      if (nowActive !== active) {
        active = nowActive
        if (interval) clearInterval(interval)
        interval = window.setInterval(tick, active ? 1000 : 5000)
      }
    }
    tick()
    interval = window.setInterval(tick, active ? 1000 : 5000)
  }, [])
  const [editSubjectId, setEditSubjectId] = useState('')

  async function saveEditLog() {
    if (!editLog) return
    const prevSession = { ...editLog }
    // Preserve original time-of-day; only change date if user picked a different date
    const originalStart = new Date(editLog.startAt)
    const newStart = new Date(`${editDate}T${originalStart.toTimeString().slice(0, 8)}`)
    const newEnd = new Date(newStart.getTime() + editDuration * 60_000)
    const updated: Record<string, unknown> = {
      startAt: newStart.toISOString(),
      endAt: newEnd.toISOString(),
      durationMinutes: editDuration,
      durationSeconds: editDuration * 60,
      subjectId: editSubjectId,
      updatedAt: isoNow(),
    }
    await db.sessions.update(editLog.id, updated)
    await updateStreakDayForSession({ ...editLog, ...updated })
    await loadData()
    setEditLog(null)
    push({
      description: `Edited session`,
      undo: async () => { await db.sessions.update(editLog.id, { startAt: prevSession.startAt, endAt: prevSession.endAt, durationMinutes: prevSession.durationMinutes, durationSeconds: prevSession.durationSeconds, subjectId: prevSession.subjectId, updatedAt: prevSession.updatedAt }); await loadData() },
      redo: async () => { await db.sessions.update(editLog.id, updated); await loadData() },
    })
  }

  async function deleteSession(id: string) {
    const session = data.sessions.find((s) => s.id === id)
    if (!session) return
    await db.sessions.delete(id)
    syncSessionDelete(id)
    await revertRoutineLogsForSession(session)
    await revertStreakDayForSession(session)
    await loadData()
    push({
      description: `Deleted session (${session.durationMinutes}m)`,
      undo: async () => { await db.sessions.add(session); await updateRoutineLogsForSession(session); await updateStreakDayForSession(session); await syncSession(session, data.subjects.find(s => s.id === session.subjectId)?.name ?? 'Unknown'); await loadData() },
      redo: async () => { await db.sessions.delete(id); await revertRoutineLogsForSession(session); await revertStreakDayForSession(session); await syncSessionDelete(id); await loadData() },
    })
  }

  async function deleteSelectedSessions() {
    for (const id of selectedSessionIds) {
      const session = data.sessions.find(s => s.id === id)
      if (session) {
        await db.sessions.delete(id)
        syncSessionDelete(id)
        await revertRoutineLogsForSession(session)
        await revertStreakDayForSession(session)
      }
    }
    setSelectedSessionIds(new Set()); setSelectionMode(false)
    await loadData()
  }

  async function batchChangeSubject() {
    if (!batchSubjectId) return
    for (const id of selectedSessionIds) {
      await db.sessions.update(id, { subjectId: batchSubjectId, updatedAt: isoNow() })
    }
    setSelectedSessionIds(new Set()); setSelectionMode(false)
    setBatchSubjectModalOpen(false)
    setBatchSubjectId('')
    await loadData()
  }
  const toggleWidget = (id: string) => {
    if (visibleWidgets.includes(id)) {
      setVisibleWidgets(visibleWidgets.filter((w) => w !== id))
    } else {
      // Insert at the original position from DASHBOARD_WIDGETS_METADATA so
      // the widget returns to its natural slot after being toggled off/on.
      const targetIdx = DASHBOARD_WIDGETS_METADATA.findIndex((w) => w.id === id)
      const insertAt = visibleWidgets.findIndex((vid) => {
        const mi = DASHBOARD_WIDGETS_METADATA.findIndex((w) => w.id === vid)
        return mi > targetIdx
      })
      const next = [...visibleWidgets]
      if (insertAt === -1) next.push(id)
      else next.splice(insertAt, 0, id)
      setVisibleWidgets(next)
    }
  }

  // Log time shortcut (Cmd+L or N on dashboard)
  useEffect(() => {
    function onLogTime() { setLogModalOpen(true) }
    window.addEventListener('momentum:log-time', onLogTime)
    return () => window.removeEventListener('momentum:log-time', onLogTime)
  }, [])

  // Widget toggle shortcuts (1-8)
  useEffect(() => {
    function onToggle(e: Event) {
      const idx = (e as CustomEvent).detail as number
      const widget = visibleWidgets[idx - 1]
      if (widget) toggleWidget(widget)
    }
    window.addEventListener('momentum:dashboard-toggle-widget', onToggle)
    return () => window.removeEventListener('momentum:dashboard-toggle-widget', onToggle)
  }, [visibleWidgets, toggleWidget])

  // Calendar month navigation
  useEffect(() => {
    function onPrevMonth() { setCalendarMonth(d => subMonths(d, 1)) }
    function onNextMonth() { setCalendarMonth(d => addMonths(d, 1)) }
    function onToday() { setCalendarMonth(new Date()) }
    window.addEventListener('momentum:dashboard-calendar-prev', onPrevMonth)
    window.addEventListener('momentum:dashboard-calendar-next', onNextMonth)
    window.addEventListener('momentum:dashboard-calendar-today', onToday)
    return () => {
      window.removeEventListener('momentum:dashboard-calendar-prev', onPrevMonth)
      window.removeEventListener('momentum:dashboard-calendar-next', onNextMonth)
      window.removeEventListener('momentum:dashboard-calendar-today', onToday)
    }
  }, [])



  if (isLoading) return <PageSpinner />
  const todayMinutes = academicSessions
    .filter((s) => toLocalDateString(s.startAt) === todayStr)
    .reduce((sum, s) => sum + s.durationMinutes, 0)
  const liveTotalTodayMinutes = getTotalTodayMinutes(data.sessions, data.subjects, data.categories)
  const goalPct = Math.min(100, Math.round((todayMinutes / settings.dailyTargetMinutes) * 100))
  const allRecent = academicSessions
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())
    .slice(0, 50)
    .map((s) => ({
      ...s,
      subjectName: data.subjects.find((sub) => sub.id === s.subjectId)?.name ?? 'Unknown',
      subjectColor: data.subjects.find((sub) => sub.id === s.subjectId)?.color ?? '#94a3b8',
    }))
  const recentSessions = allRecent.slice(0, recentLimit)


  const sizeClasses: Record<string, string> = {
    small: 'lg:col-span-1 lg:row-span-1',
    medium: 'lg:col-span-2 lg:row-span-1',
    large: 'lg:col-span-3 lg:row-span-2',
  }

  function removeWidgetWithUndo(id: string) {
    const previousIndex = visibleWidgets.indexOf(id)
    setVisibleWidgets(prev => prev.filter(w => w !== id))
    const label = DASHBOARD_WIDGETS_METADATA.find(w => w.id === id)?.label || id
    push({
      description: `Removed ${label} widget`,
      undo: async () => setVisibleWidgets(prev => {
        const next = [...prev]
        next.splice(previousIndex, 0, id)
        return next
      }),
      redo: async () => setVisibleWidgets(prev => prev.filter(w => w !== id)),
    })
  }

  function renderWidget(id: string): React.ReactNode {
    switch (id) {
      case 'stats':
        return (
          <div className="flex flex-col items-center justify-center py-2">
            <div className="text-xs font-medium uppercase tracking-wide text-primary-600 dark:text-primary-400">
              Today&apos;s Study Time
            </div>
            <div className="mt-1 text-3xl font-bold text-slate-800 dark:text-slate-100">
              {formatTotalToday(liveTotalTodayMinutes, isTimerActive())}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Daily target: {formatMinutes(settings.dailyTargetMinutes)}
            </div>
            {goalPct >= 100 ? (
              <div className="text-xs font-medium text-green-600 dark:text-green-400">Target reached!</div>
            ) : (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {formatMinutes(settings.dailyTargetMinutes - Math.round(liveTotalTodayMinutes))} remaining
              </div>
            )}
          </div>
        )
      case 'pomodoro':
        return (
          <div data-tour="timer" className="rounded-lg border-2 border-primary-500 p-4">
            <PomodoroTimer />
          </div>
        )
      case 'today':
        return (
          <Card>
            <div className="mb-4 grid grid-cols-2 gap-4 border-b border-slate-200 pb-3 dark:border-slate-700">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Today</div>
                <div className="mt-0.5 text-2xl font-bold text-slate-800 dark:text-slate-100">
                  {formatTotalToday(liveTotalTodayMinutes, isTimerActive())}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">This Week</div>
                <div className="mt-0.5 text-2xl font-bold text-slate-800 dark:text-slate-100">
                  {(() => {
                    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
                    const weekAgoStr = format(weekAgo, 'yyyy-MM-dd')
                    const weekMins = academicSessions
                      .filter((s) => s.startAt >= weekAgoStr + 'T00:00:00')
                      .reduce((sum, s) => sum + s.durationMinutes, 0)
                    return formatMinutes(weekMins)
                  })()}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Routines</span>
                  <Link to="/routines" className="text-xs text-primary-600 hover:underline">Manage</Link>
                </div>
                {(() => {
                  const todayDow = new Date().getDay() as DayOfWeek
                  const todaysRoutines = data.routines.filter((r) => !r.deletedAt && (r.dayMinutes[todayDow] ?? 0) > 0)
                  if (todaysRoutines.length === 0) return <p className="text-sm text-slate-500">No routines scheduled</p>
                  const logMap: Record<string, RoutineLog> = {}
                  data.routineLogs.forEach((l) => { if (l.date === todayStr) logMap[l.routineId] = l })
                  const scheduled = todaysRoutines.reduce((s, r) => s + (r.dayMinutes[todayDow] ?? 0), 0)
                  const completed = todaysRoutines.reduce((s, r) => {
                    const log = logMap[r.id]
                    return s + (log ? Math.min(log.actualMinutes, r.dayMinutes[todayDow] ?? 0) : 0)
                  }, 0)
                  const pct = scheduled > 0 ? Math.round((completed / scheduled) * 100) : 0
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-700 dark:text-slate-300">{completed} / {scheduled}m</span>
                        <span className="font-medium text-primary-600">{pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700">
                        <div className="h-2 rounded-full bg-primary-500" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <TodaysRoutinesList
                        routines={data.routines}
                        routineLogs={data.routineLogs}
                        subjects={data.subjects}
                        todayStr={todayStr}
                        todayDow={new Date().getDay() as DayOfWeek}
                        maxItems={5}
                      />
                    </div>
                  )
                })()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Tasks Due</span>
                  <Link to="/calendar" className="text-xs text-primary-600 hover:underline">View</Link>
                </div>
                {(() => {
                  const due = data.assignments
                    .filter((a) => !a.deletedAt && !a.completed && a.dueDate !== '' && a.dueDate <= todayStr)
                    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                    .slice(0, 5)
                  if (due.length === 0) return <p className="text-sm text-slate-500">No tasks due today</p>
                  return (
                    <ul className="space-y-1">
                      {due.map((a) => (
                        <li key={a.id} className="flex items-center justify-between text-sm">
                          <span className="truncate text-slate-700 dark:text-slate-300">{a.title}</span>
                          <span className={cn(
                            'ml-2 shrink-0 text-xs',
                            a.dueDate < todayStr ? 'text-red-500' : 'text-slate-400'
                          )}>
                            {a.dueDate === todayStr ? 'Today' : a.dueDate ? `Overdue ${format(new Date(a.dueDate), 'd MMM')}` : 'No date'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )
                })()}
              </div>
            </div>
            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Today by Subject</span>
              </div>
              <SubjectBreakdown
                sessions={academicSessions}
                subjects={data.subjects}
                todayStr={todayStr}
                liveTimerSeconds={liveTimerSeconds}
                liveTimerSubjectId={liveTimerSubjectId}
              />
            </div>
          </Card>
        )
      case 'streak-goal': {
        const nextMilestone = STREAK_MILESTONES.find(m => m > streak) ?? streak
        const progressPercent = Math.min(100, Math.round((streak / nextMilestone) * 100))
        return (
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <div className="flex items-end gap-2">
                <div className={cn('relative w-16 h-16 rounded-full', streak > 0 && todayMinutes === 0 && 'ring-2 ring-amber-400 ring-offset-2 ring-offset-white dark:ring-offset-slate-800 animate-[milestone-pulse_2s_ease-in-out_infinite]')}>
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <circle
                      className="text-slate-200 dark:text-slate-700"
                      stroke="currentColor"
                      strokeWidth="3"
                      fill="transparent"
                      r="16"
                      cx="18"
                      cy="18"
                    />
                    <circle
                      className="text-orange-500"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      fill="transparent"
                      r="16"
                      cx="18"
                      cy="18"
                      strokeDasharray="100.53"
                      strokeDashoffset={100.53 - (100.53 * progressPercent) / 100}
                      style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-2xl font-bold text-orange-500 leading-none">{streak}</div>
                    {streak > 0 && todayMinutes === 0 && <span className="text-[8px] text-amber-500/70 leading-none mt-0.5">at risk</span>}
                  </div>
                </div>
                <span className="text-sm text-slate-500">day{streak !== 1 ? 's' : ''}</span>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>Best <span className="font-semibold text-slate-700 dark:text-slate-200">{longestStreak}</span></div>
              </div>
            </div>
            {streak === 0 && <p className="text-sm text-slate-500">Log a session today to start your streak!</p>}
            {streak > 0 && todayMinutes === 0 && <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Log today to keep your streak!</p>}
            <div>
              <div className="mb-1 grid grid-cols-7 gap-px text-[10px] font-medium text-slate-400">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((l, i) => (
                  <div key={i} className="text-center">{l}</div>
                ))}
              </div>
              <div className="relative">
                <div className="grid grid-cols-7 gap-px rounded-sm border border-slate-200 bg-slate-200 dark:border-slate-700 dark:bg-slate-700 p-px">
                  {(() => {
                    const HEATMAP_DAYS = 60
                    const targetMinutes = Math.max(1, settings.dailyTargetMinutes)
                    function getHeatCategory(minutes: number): 'none' | 'started' | 'near' | 'met' {
                      if (minutes <= 0) return 'none'
                      if (minutes >= targetMinutes) return 'met'
                      if (minutes >= targetMinutes * 0.75) return 'near'
                      return 'started'
                    }
                    const heatDays = Array.from({ length: HEATMAP_DAYS }, (_, i) => {
                      const d = subDays(new Date(), HEATMAP_DAYS - 1 - i)
                      const ds = format(d, 'yyyy-MM-dd')
                      return { date: d, ds, minutes: minutesByDay[ds] ?? 0 }
                    })
                    const firstDow = heatDays[0].date.getDay()
                    return (
                      <>
                        {Array.from({ length: firstDow }).map((_, i) => <div key={`pad-${i}`} />)}
                        {heatDays.map(({ date, ds, minutes }) => {
                          const isToday = ds === todayStr
                          const category = getHeatCategory(minutes)
                          const metTarget = minutes >= targetMinutes
                          return (
                            <div
                              key={ds}
                              className={cn(
                                'group relative flex h-4 items-center justify-center text-[10px] font-medium transition-all border',
                                isToday && 'ring-2 ring-orange-400 ring-inset z-10',
                                category === 'none' && 'border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400',
                                category === 'started' && 'border-amber-200 bg-amber-200 text-amber-900 dark:border-amber-800 dark:bg-amber-900/50 dark:text-amber-100',
                                category === 'near' && 'border-orange-400 bg-orange-500 text-white dark:border-orange-300 dark:bg-orange-600',
                                category === 'met' && 'border-green-600 bg-green-700 text-white dark:border-green-400 dark:bg-green-500',
                              )}
                            >
                              <span>{date.getDate()}</span>
                              <div className="pointer-events-none absolute -top-10 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-slate-200 dark:text-slate-800">
                                {format(date, 'd MMM')}: {formatMinutes(minutes)} • {metTarget ? 'Target met' : minutes > 0 ? 'Below target' : 'No study'}
                              </div>
                            </div>
                          )
                        })}
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
              <span>No study</span>
              <div className="h-3 w-3 rounded-sm border border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-800" />
              <span>Started</span>
              <div className="h-3 w-3 rounded-sm border border-amber-200 bg-amber-200 dark:border-amber-800 dark:bg-amber-900/50" />
              <span>Near target</span>
              <div className="h-3 w-3 rounded-sm border border-orange-400 bg-orange-500" />
              <span>Target met</span>
              <div className="h-3 w-3 rounded-sm border border-green-600 bg-green-700 dark:border-green-400 dark:bg-green-500" />
            </div>
            <div className="text-xs text-slate-500">Streak milestones:</div>
            <div className="flex flex-wrap gap-2">
              {STREAK_MILESTONES.map((m) => {
                const reached = streak >= m
                const approached = m === nextMilestone
                return (
                  <div key={m} className="group relative">
                    <div
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-semibold transition-all',
                        reached
                          ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                        approached && !reached && 'animate-[milestone-pulse_2s_ease-in-out_infinite]'
                      )}
                    >
                      {reached && <span className="mr-1">🔥</span>}
                      {m}d
                    </div>
                    <div className="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-slate-200 dark:text-slate-800">
                      {reached ? `${m} days — milestone reached!` : `Reach ${m} days`}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      }
      case 'study-review':
        return (
          <Card>
            <CardHeader>
              <CardTitle>
                <Link to="/study/review" className="hover:underline">Study Review</Link>
              </CardTitle>
            </CardHeader>
            <div className="px-4 pb-4">
              {(() => {
                const activeAreas = data.studyAreas.filter(a => !a.deletedAt)
                const dueCount = getDueCount(activeAreas)
                if (activeAreas.length === 0) {
                  return (
                    <div className="text-sm text-slate-500">
                      No study areas yet. <Link to="/study" className="text-primary-600 hover:underline">Add your first area</Link>.
                    </div>
                  )
                }
                if (dueCount === 0) {
                  return <div className="text-sm text-slate-500">No areas due today. Check back later.</div>
                }
                return (
                  <div>
                    <p className="text-3xl font-bold text-amber-600">{dueCount}</p>
                    <p className="text-sm text-slate-500 mt-1">
                      area{dueCount === 1 ? '' : 's'} due today
                    </p>
                    <Link to="/study/review">
                      <Button size="sm" className="mt-3">Start Review</Button>
                    </Link>
                  </div>
                )
              })()}
            </div>
          </Card>
        )
      case 'calendar':
        return (
          <Card>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700">←</button>
                <span className="text-sm font-medium">{format(calendarMonth, 'MMMM yyyy')}</span>
                <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700">→</button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs mb-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1 font-medium text-slate-500">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: calendarDays.pad }).map((_, i) => <div key={`pad-${i}`} />)}
              {Array.from({ length: calendarDays.daysInMonth }, (_, i) => {
                const dayNum = i + 1
                const dateStr = `${format(calendarMonth, 'yyyy-MM')}-${String(dayNum).padStart(2, '0')}`
                const mins = minutesByDay[dateStr] ?? 0
                const intensity = heatMax > 0 ? mins / heatMax : 0
                const isToday = dateStr === todayStr
                const isFuture = dateStr > todayStr
                return (
                  <div
                    key={dayNum}
                    title={`${dateStr}: ${formatMinutes(mins)}`}
                    className={cn(
                      'flex min-h-[2.5rem] flex-col items-center justify-center rounded text-xs transition-all overflow-hidden',
                      isToday && 'ring-2 ring-primary-500',
                      isFuture && 'text-slate-300 dark:text-slate-600',
                      !isFuture && mins === 0 && 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                      mins > 0 && 'text-white font-medium',
                      mins > 0 && intensity < 0.2 && 'bg-green-200 dark:bg-green-900/50',
                      mins > 0 && intensity >= 0.2 && intensity < 0.4 && 'bg-green-400 dark:bg-green-800',
                      mins > 0 && intensity >= 0.4 && intensity < 0.6 && 'bg-green-600 dark:bg-green-700',
                      mins > 0 && intensity >= 0.6 && intensity < 0.8 && 'bg-green-700 dark:bg-green-600',
                      mins > 0 && intensity >= 0.8 && 'bg-green-800 dark:bg-green-500',
                    )}
                  >
                    <span>{dayNum}</span>
                    {mins > 0 && <span className="text-[10px] opacity-80 truncate max-w-full leading-tight">{formatMinutes(mins)}</span>}
                  </div>
                )
              })}
            </div>
            <div className="mt-2 flex items-center justify-end gap-1 text-xs text-slate-500">
              <span>No study</span>
              <div className="h-3 w-3 rounded-sm bg-slate-100 dark:bg-slate-800" />
              <div className="h-3 w-3 rounded-sm bg-green-200 dark:bg-green-900/50" />
              <div className="h-3 w-3 rounded-sm bg-green-600 dark:bg-green-700" />
              <div className="h-3 w-3 rounded-sm bg-green-800 dark:bg-green-500" />
              <span>Full</span>
            </div>
          </Card>
        )
      case 'recent':
        return (
          <Card>
            {recentSessions.length === 0 ? (
              <p className="text-sm text-slate-500">No sessions yet. Start studying!</p>
            ) : (
              <div className="space-y-3">
                {selectedSessionIds.size === 0 && (
                  <div className="flex justify-end">
                    <Button size="sm" variant="secondary" onClick={() => setSelectionMode(true)}>Select Sessions</Button>
                  </div>
                )}
                {selectedSessionIds.size > 0 && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-primary-300 bg-primary-50 px-3 py-2 dark:border-primary-700 dark:bg-primary-900/30">
                    <span className="text-sm font-medium text-primary-900 dark:text-primary-100">
                      {selectedSessionIds.size} selected
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => { setSelectedSessionIds(new Set()); setSelectionMode(false) }}>Cancel</Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setSelectedSessionIds(new Set())}
                      >
                        Clear
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setBatchSubjectModalOpen(true)}
                      >
                        Change Subject
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={async () => {
                          if (confirm(`Delete ${selectedSessionIds.size} session(s)?`)) {
                            await deleteSelectedSessions()
                          }
                        }}
                      >
                        Delete Selected
                      </Button>
                    </div>
                  </div>
                )}
                {allRecent.length > recentLimit && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="text-xs font-medium text-primary-600 hover:underline"
                      onClick={() => setRecentLimit((n) => n + 10)}
                    >
                      Load more
                    </button>
                  </div>
                )}
                {academicSessions.length > 50 && (
                  <div className="text-right text-xs text-slate-500">
                    Showing {recentSessions.length} of {allRecent.length}
                  </div>
                )}
                {(() => {
                  const groups: { label: string; items: typeof recentSessions }[] = []
                  const todayKey = format(new Date(), 'yyyy-MM-dd')
                  const yesterdayKey = format(subDays(new Date(), 1), 'yyyy-MM-dd')
                  for (const s of recentSessions) {
                    const ds = toLocalDateString(s.startAt)
                    let label: string
                    if (ds === todayKey) label = 'Today'
                    else if (ds === yesterdayKey) label = 'Yesterday'
                    else label = format(new Date(s.startAt), 'EEE d MMM')
                    let g = groups.find((x) => x.label === label)
                    if (!g) {
                      g = { label, items: [] }
                      groups.push(g)
                    }
                    g.items.push(s)
                  }
                  return groups.map((g) => (
                    <div key={g.label}>
                      <div className="sticky top-0 z-10 -mx-1 bg-white/90 px-1 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur dark:bg-slate-800/90">{g.label}</div>
                      <ul className="divide-y divide-slate-200">
                        {g.items.map((session) => {
                          const project = session.projectId ? data.projects.find((p) => p.id === session.projectId) : undefined
                          return (
                            <SessionRow
                              key={session.id}
                              session={session}
                              project={project}
                              menuSessionId={menuSessionId}
                              setMenuSessionId={setMenuSessionId}
                              setEditLog={setEditLog}
                              setEditDuration={setEditDuration}
                              setEditDate={setEditDate}
                              setEditSubjectId={setEditSubjectId}
                              deleteSession={deleteSession}
                              selected={selectedSessionIds.has(session.id)}
                              onToggleSelect={(id) => setSelectedSessionIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })}
                              selectionMode={selectionMode || selectedSessionIds.size > 0}
                              setViewSession={setViewSession}
                              setViewModalOpen={setViewModalOpen}
                            />
                          )
                        })}
                      </ul>
                    </div>
                  ))
                })()}
              </div>
            )}
          </Card>
        )
      case 'today-schedule':
        return (
          <Card>
            {(() => {
              const todayDow = new Date().getDay() as DayOfWeek
              const todayStr = format(new Date(), 'yyyy-MM-dd')
              
              // Build the list of activities due today that are not yet handled.
              const handledLogMap = new Map<string, boolean>()
              for (const log of data.activityLogs) {
                if (log.date === todayStr && (log.status === 'completed' || log.status === 'skipped')) {
                  handledLogMap.set(log.activityId, true)
                }
              }
              
              const sessionSubjectIds = new Set<string>()
              for (const s of data.sessions) {
                if (!s.deletedAt && toLocalDateString(s.startAt) === todayStr) {
                  sessionSubjectIds.add(s.subjectId)
                }
              }
              
              const now = new Date()
              const currentTimeStr = format(now, 'HH:mm')
              
              const pendingActivities = data.activities.filter((a) => {
                if (handledLogMap.has(a.id)) return false
                const mins = a.dayMinutes[todayDow]
                if (!mins || mins <= 0) return false
                if (a.subjectId && sessionSubjectIds.has(a.subjectId)) return false
                if (a.scheduledTime && a.scheduledTime > currentTimeStr) return false
                return true
              })
              
              if (pendingActivities.length === 0) {
                return <p className="text-sm text-slate-500">No pending activities today</p>
              }
              
              const activity = pendingActivities[0]
              const pendingCount = pendingActivities.length
              const dayMinutes = activity.dayMinutes[todayDow] ?? 0
              const subject = data.subjects.find((s) => s.id === activity.subjectId)
              
              return (
                <div className="rounded-lg border border-primary-200 bg-primary-50 p-4 dark:border-primary-800 dark:bg-primary-900/20">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: activity.color }}
                        />
                        <p className="text-sm font-medium text-primary-800 dark:text-primary-200">
                          {activity.name}
                        </p>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
                        {subject && (
                          <span className="rounded-full border border-primary-300 bg-white px-2 py-0.5 text-primary-700 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                            {data.subjects.find(s => s.id === activity.subjectId)?.name ?? 'Unknown'}
                          </span>
                        )}
                        {activity.scheduledTime && (
                          <span className="rounded-full border border-primary-300 bg-white px-2 py-0.5 text-primary-700 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                            {activity.scheduledTime}
                          </span>
                        )}
                        <span className="rounded-full border px-2 py-0.5" style={{ borderColor: activity.color, color: activity.color }}>
                          {dayMinutes} min
                        </span>
                      </div>
                      {activity.notes && (
                        <p className="mt-1.5 text-xs text-primary-600 dark:text-primary-400 italic">{activity.notes}</p>
                      )}
                      {pendingCount > 1 && (
                        <p className="mt-0.5 text-xs text-primary-600 dark:text-primary-400">
                          {pendingCount - 1} more pending
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="primary" size="sm" onClick={async () => {
                        const now = isoNow()
                        if (activity.subjectId) {
                          const session: Session = {
                            id: uuid(),
                            subjectId: activity.subjectId,
                            startAt: now,
                            endAt: now,
                            durationMinutes: dayMinutes,
                            source: 'manual',
                            createdAt: now,
                            updatedAt: now,
                          }
                          await db.sessions.add(session)
                          await updateRoutineLogsForSession(session)
                          await updateStreakDayForSession(session)
                        }
                        const logEntry = {
                          id: uuid(),
                          activityId: activity.id,
                          date: todayStr,
                          status: 'completed' as const,
                          actualMinutes: dayMinutes,
                          createdAt: now,
                        }
                        await db.activityLogs.add(logEntry)
                        await loadData()
                      }}>Yes, logged</Button>
                      <Button variant="secondary" size="sm" onClick={async () => {
                        const now = isoNow()
                        const logEntry = {
                          id: uuid(),
                          activityId: activity.id,
                          date: todayStr,
                          status: 'skipped' as const,
                          createdAt: now,
                        }
                        await db.activityLogs.add(logEntry)
                        await loadData()
                      }}>No, skip</Button>
                    </div>
                  </div>
                </div>
              )
            })()}
          </Card>
        )
      case 'auto-log':
        return (
          <div className="space-y-3 p-2">
            {(() => {
              const pendingSessions = data.sessions.filter(s => s.source === 'autoRoutine' && s.deletedAt)
              if (pendingSessions.length === 0) {
                return <p className="text-sm text-slate-500 p-4">No pending auto-logged sessions</p>
              }
              return (
                <>
                  {pendingSessions.map(session => {
                    const subject = data.subjects.find(s => s.id === session.subjectId)
                    const project = session.projectId ? data.projects.find(p => p.id === session.projectId) : undefined
                    return (
                      <div key={session.id} className="flex items-center justify-between p-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800">
                        <div className="flex min-w-0 items-center gap-2">
                          {subject && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: subject.color }} />}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                              {subject?.name ?? 'Unknown Subject'}
                              {project && <span className="text-slate-500"> · {project.name}</span>}
                            </div>
                            <div className="text-xs text-slate-500">
                              {format(new Date(session.startAt), 'h:mm a')} • {formatMinutes(session.durationMinutes)}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={async () => {
                              await db.sessions.delete(session.id)
                              await loadData()
                            }}
                          >
                            Skip
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={async () => {
                              await db.sessions.update(session.id, { deletedAt: null, updatedAt: isoNow() })
                              await loadData()
                            }}
                          >
                            Confirm
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </>
              )
            })()}
          </div>
        )
      case 'assignments':
        return (
          <Card>
            {(() => {
              const upcomingAssignments = data.assignments
                .filter((a) => !a.deletedAt && !a.completed && a.dueDate !== '' && a.dueDate >= todayStr)
                .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                .slice(0, 10)
              
              if (upcomingAssignments.length === 0) {
                return <p className="text-sm text-slate-500">No upcoming assignments</p>
              }
              
              return (
                <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                  {upcomingAssignments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-2">
                      <div className="min-w-0 flex-1">
                        <Link to={`/calendar?task=${a.id}`} className="text-sm font-medium text-slate-800 dark:text-slate-100 hover:text-primary-600 truncate block">
                          {a.title}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {a.dueDate === todayStr ? 'Due today' : `Due ${format(new Date(a.dueDate), 'MMM d')}`}
                          {a.projectId && ` · ${data.projects.find(p => p.id === a.projectId)?.name ?? ''}`}
                        </div>
                      </div>
                      {a.completed && (
                        <span className="text-xs text-green-600">Completed</span>
                      )}
                    </li>
                  ))}
                </ul>
              )
            })()}
          </Card>
        )
      default:
        return null
    }
  }

  return (
    <div data-tour="dashboard" className="space-y-6">
      <button
        type="button"
        className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        onClick={() => setCustomizeOpen(true)}
      >
        Customise
      </button>
      {/* Dashboard grid with widgets */}
      {showActivityConfirmation && (
        <ActivityConfirmationCard onDismiss={() => setShowActivityConfirmation(false)} />
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-[minmax(80px,auto)] grid-flow-dense">
        {visibleWidgets.map(id => {
          const size = widgetConfigs[id]?.size || 'small'
          const meta = DASHBOARD_WIDGETS_METADATA.find(w => w.id === id)
          const label = meta?.label || id
          const widgetProps = {
            id,
            label,
            size,
            onRemove: () => removeWidgetWithUndo(id),
            onSetSize: (s: 'small' | 'medium' | 'large') => setWidgetSize(id, s),
            onReorder: reorderWidgets,
            ...(id === 'calendar' || id === 'recent' ? { defaultOpen: false } : {}),
          } as const
          return (
            <div key={id} className={cn(sizeClasses[size], 'h-full')}>
              <DashboardWidget {...widgetProps}>
                {renderWidget(id)}
              </DashboardWidget>
            </div>
          )
        })}
      </div>
      <Modal open={customizeOpen} onClose={() => setCustomizeOpen(false)} title="Customise Dashboard">
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {DASHBOARD_WIDGETS_METADATA.map((w) => {
            const visIdx = visibleWidgets.indexOf(w.id)
            const isVisible = visIdx !== -1
            const size = widgetConfigs[w.id]?.size || 'small'
            return (
              <div key={w.id} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                <span className="cursor-grab text-slate-400" title="Drag to reorder">⠿</span>
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={() => toggleWidget(w.id)}
                  className="rounded border-slate-300"
                />
                <span className="flex-1 text-sm">{w.label}</span>
                <div className="flex gap-1">
                  {(['small', 'medium', 'large'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setWidgetConfig(w.id, { size: s })}
                      className={cn(
                        'px-2 py-0.5 text-xs rounded font-medium transition',
                        size === s
                          ? 'bg-primary-500 text-white'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 hover:bg-slate-200'
                      )}
                    >
                      {s === 'small' ? 'S' : s === 'medium' ? 'M' : 'L'}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-4 flex justify-between">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setVisibleWidgets(DEFAULT_WIDGET_IDS)
              setWidgetConfigs(DEFAULT_CONFIGS)
            }}
          >
            Reset to defaults
          </Button>
          <Button size="sm" onClick={() => setCustomizeOpen(false)}>Done</Button>
        </div>
      </Modal>

      <div className="fixed bottom-6 right-6 z-40 fab-container">
        {fabOpen && (
          <div className="absolute bottom-16 right-0 mb-4 flex flex-col items-end gap-2">
            {[
              { label: 'Log study time', icon: '⏱', onClick: () => { setLogModalOpen(true); setFabOpen(false) } },
              { label: 'Start quick Pomodoro', icon: '🍅', onClick: () => { navigate('/study'); setFabOpen(false) } },
              { label: 'Add a new mark', icon: '📝', onClick: () => { navigate('/marks'); setFabOpen(false) } },
              { label: 'Add a new task', icon: '📅', onClick: () => { navigate('/calendar'); setFabOpen(false) } },
              { label: 'Add a new subject', icon: '+', onClick: () => { navigate('/subjects'); setFabOpen(false) } },
            ].map((action, i) => (
              <div key={i} className="group relative flex items-center">
                <div className="absolute right-14 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-slate-200 dark:text-slate-800 pointer-events-none">
                  {action.label}
                </div>
                <button
                  onClick={action.onClick}
                  className="h-10 w-10 rounded-full border border-slate-200 bg-white shadow-md transition-all duration-200 hover:scale-110 dark:border-slate-600 dark:bg-slate-700 flex items-center justify-center"
                >
                  {action.icon}
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => setFabOpen(!fabOpen)}
          className={cn(
            "h-14 w-14 rounded-full bg-primary-600 text-white shadow-lg transition-all duration-200 text-2xl flex items-center justify-center",
            !fabOpen && "animate-pulse",
            fabOpen && "rotate-45"
          )}
          aria-label="Quick add"
        >
          +
        </button>
      </div>

      <Modal open={logModalOpen} onClose={() => setLogModalOpen(false)} title="Log Study Time">
        <div className="space-y-3">
          {(() => {
            const existingToday = todayAcademicMinutes
            const previewTotal = existingToday + logDuration
            const target = settings.dailyTargetMinutes
            const toGo = Math.max(0, target - previewTotal)
            return (
              <div className="text-sm text-slate-600 dark:text-slate-400">
                Today: {formatMinutes(previewTotal)} (of {formatMinutes(target)} goal) — {toGo > 0 ? `${formatMinutes(toGo)} to go` : 'goal reached'}
              </div>
            )
          })()}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Subject</label>
              <select className="input" value={logSubjectId} onChange={(e) => { const val = e.target.value; setLogSubjectId(val); setLogProjectId(''); setLogTaskId('') }}>
                <option value="">Select subject</option>
                {data.subjects.filter(s => !s.deletedAt).map((s) => <option key={s.id} value={s.id}>{getSubjectPathLabel(s.id, data.subjects)}</option>)}
              </select>
            </div>
            {logSubjectId && data.projects.filter((p) => !p.deletedAt && p.subjectId === logSubjectId).length > 0 && (
              <div>
                <label className="label">Project (optional)</label>
                <select className="input" value={logProjectId} onChange={(e) => { const pid = e.target.value; setLogProjectId(pid); setLogTaskId(''); if (pid && !logSubjectId) { const proj = data.projects.find((p) => p.id === pid); if (proj) setLogSubjectId(proj.subjectId) } }}>
                  <option value="">— Select project —</option>
                  {data.projects.filter((p) => !p.deletedAt && p.subjectId === logSubjectId).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            {logProjectId && (
              <div>
                <label className="label">Task (optional)</label>
                <select className="input" value={logTaskId} onChange={(e) => setLogTaskId(e.target.value)}>
                  <option value="">— Select task —</option>
                  {data.assignments.filter((a) => a.projectId === logProjectId && !a.completed && !a.deletedAt).map((a) => (
                    <option key={a.id} value={a.id}>{a.title}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Minutes</label>
              <NumberInput value={logDuration} onChange={setLogDuration} min={1} className="input w-24" />
            </div>
            <div>
              <label className="label">Date</label>
              <input type="date" className="input" max={todayStr} value={logDate} onChange={(e) => setLogDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Time (optional)</label>
              <input type="time" className="input" value={logTime} onChange={(e) => setLogTime(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="label">Note (optional)</label>
              <input className="input w-full" placeholder="What did you work on?" value={logNote} onChange={(e) => setLogNote(e.target.value)} />
            </div>
            <div className="w-full">
              <label className="label">Focus quality (optional)</label>
              <div className="flex gap-1 flex-wrap" role="group" aria-label="Focus tag">
                {(['focused', 'distracted', 'group', 'revision'] as const).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setLogFocusTag(logFocusTag === tag ? null : tag)}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs border',
                      logFocusTag === tag
                        ? 'border-primary-500 bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200'
                        : 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400'
                    )}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
            <Button
              disabled={!logSubjectId && !logProjectId}
              onClick={async () => {
                await handleLogTime()
                setLogModalOpen(false)
              }}
            >
              Log Time
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Session Modal */}
      <Modal open={editLog !== null} onClose={() => setEditLog(null)} title="Edit Session">
        <div className="space-y-3">
          <div>
            <label className="label">Minutes</label>
            <NumberInput value={editDuration} onChange={setEditDuration} min={1} className="input" />
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" max={todayStr} value={editDate} onChange={(e) => setEditDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Subject</label>
            <select className="input" value={editSubjectId} onChange={(e) => setEditSubjectId(e.target.value)}>
              <option value="">— Select subject —</option>
              {data.subjects.filter((s) => !s.deletedAt).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <Button variant="primary" className="w-full" onClick={saveEditLog}>Save</Button>
        </div>
      </Modal>
      {/* Batch Change Subject Modal */}
      <Modal open={batchSubjectModalOpen} onClose={() => { setBatchSubjectModalOpen(false); setBatchSubjectId('') }} title="Change Subject for Selected Sessions">
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This will change the subject for {selectedSessionIds.size} selected session(s).
          </p>
          <div>
            <label className="label">New Subject</label>
            <select className="input" value={batchSubjectId} onChange={(e) => setBatchSubjectId(e.target.value)}>
              <option value="">— Select subject —</option>
              {data.subjects.filter((s) => !s.deletedAt).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setBatchSubjectModalOpen(false); setBatchSubjectId('') }}>Cancel</Button>
            <Button variant="primary" disabled={!batchSubjectId} onClick={batchChangeSubject}>Apply</Button>
          </div>
        </div>
      </Modal>
      {/* Celebration confetti overlay */}
      {showCelebration && (
        <div className="pointer-events-none fixed inset-0 z-50">
          {Array.from({ length: 25 }).map((_, i) => {
            const colors = ['bg-orange-400', 'bg-yellow-400', 'bg-red-400', 'bg-pink-400', 'bg-green-400']
            const left = Math.random() * 100
            const delay = Math.random() * 0.5
            const size = 4 + Math.random() * 6
            return (
              <div
                key={i}
                className={cn('absolute rounded-full', colors[i % colors.length])}
                style={{
                  left: `${left}%`,
                  bottom: '50%',
                  width: `${size}px`,
                  height: `${size}px`,
                  animation: `confetti-fall 2s ease-out ${delay}s forwards`,
                }}
              />
            )
          })}
        </div>
      )}
      <SessionDetailsModal
        session={viewSession}
        open={viewModalOpen}
        onClose={() => { setViewModalOpen(false); setViewSession(null) }}
        subjectName={viewSession ? data.subjects.find((s) => s.id === viewSession.subjectId)?.name : undefined}
        projectName={viewSession?.projectId ? data.projects.find((p) => p.id === viewSession.projectId)?.name : undefined}
      />
    </div>
  )
}
