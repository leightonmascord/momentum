import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { useData } from '../../app/providers'
import { db } from '../../db/app-db'
import { Button } from '../ui/Button'
import { Card, CardHeader, CardTitle } from '../ui/Card'
import { cn, isoNow, isTopLevelSubject, getChildSubjects, getSubjectPathLabel } from '../../lib/utils'
import { formatTotalToday, getTotalTodayMinutes } from '../../lib/timer-utils'
import { loadSettings, saveSettings } from '../../lib/settings-store'
import type { Settings } from '../../lib/settings-store'
import { useSessionSync } from '../../lib/use-session-sync'
import { updateRoutineLogsForSession, updateStreakDayForSession } from '../../lib/routine-tracker'
import { clearTimerState, loadTimerState, saveTimerState, savePendingSession, loadPendingSession, clearPendingSession, sessionIdFor, splitSessionAtMidnight } from '../../lib/timer-persistence'
import { FocusTagSelector, type FocusTag } from '../ui/FocusTagSelector'
import type { PersistedTimerState, PendingSession } from '../../lib/timer-persistence'
import { groupService } from '../../lib/group-service'
import { pushSettings } from '../../lib/settings-sync'
import { sendNotification, requestNotificationPermission } from '../../lib/notification-service'
import { useTimerTabLock } from '../../lib/use-timer-tab-lock'
import { clearStreakPreviewDates, setTodayPreview } from '../../lib/streak-preview'
type Mode = 'pomodoro' | 'simple'
const LAST_SUBJECT_KEY = 'momentum-last-subject'
const SAFETY_LIMIT_HOURS = 12
const SAFETY_LIMIT_SECONDS = SAFETY_LIMIT_HOURS * 3600
type Phase = 'focus' | 'shortBreak' | 'longBreak'

/** Notes textarea + focus tag selector. Used in both idle and active timer states. */
function TimerNotesAndTag({
  notes,
  onNotesChange,
  focusTag,
  onFocusTagChange,
}: {
  notes: string
  onNotesChange: (v: string) => void
  focusTag: FocusTag | null
  onFocusTagChange: (tag: FocusTag | null) => void
}) {
  return (
    <div>
      <label className="label">What are you working on?</label>
      <textarea
        placeholder="Optional notes"
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 resize-none"
        rows={2}
      />
      <FocusTagSelector value={focusTag} onChange={onFocusTagChange} />
    </div>
  )
}

/** Discard button with inline confirm/cancel. Used in both idle and active timer states. */
function DiscardButton({
  showConfirm,
  onShowConfirm,
  onCancel,
  onConfirm,
}: {
  showConfirm: boolean
  onShowConfirm: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  if (showConfirm) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm dark:border-red-800 dark:bg-red-900/30">
        <span className="text-red-700 dark:text-red-300">Discard?</span>
        <Button variant="danger" size="sm" onClick={onConfirm}>Confirm</Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    )
  }
  return (
    <Button variant="secondary" onClick={onShowConfirm}>
      Discard
    </Button>
  )
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

let sharedAudioCtx: AudioContext | null = null
function playNotificationSound() {
  try {
    if (!sharedAudioCtx) sharedAudioCtx = new AudioContext()
    const ctx = sharedAudioCtx
    if (ctx.state === 'suspended') ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 800
    gain.gain.value = 0.3
    osc.start()
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.stop(ctx.currentTime + 0.5)
  } catch {
    // Audio not available
  }
}

function getPhaseDuration(phase: Phase, cfg?: { focusMinutes: number; breakMinutes: number; longBreakMinutes: number }): number {
  const settings = loadSettings()
  const c = cfg ?? { focusMinutes: settings.pomodoroFocusMinutes, breakMinutes: settings.pomodoroBreakMinutes, longBreakMinutes: settings.pomodoroLongBreakMinutes }
  if (phase === 'focus') return c.focusMinutes * 60
  if (phase === 'shortBreak') return c.breakMinutes * 60
  return c.longBreakMinutes * 60
}


export function PomodoroTimer() {
  const { data, loadData, mutate } = useData()
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [showConfig, setShowConfig] = useState(false)

  // Local config state (editable from the gear panel)
  const [config, setConfig] = useState({
    focusMinutes: settings.pomodoroFocusMinutes,
    breakMinutes: settings.pomodoroBreakMinutes,
    longBreakMinutes: settings.pomodoroLongBreakMinutes,
    cycles: settings.pomodoroCyclesBeforeLongBreak,
    soundEnabled: settings.soundEnabled,
  })

  const [subjectId, setSubjectId] = useState<string>('')
  const [projectId, setProjectId] = useState<string>('')
  const [taskId, setTaskId] = useState<string>('')
  const [timerRoutineId, setTimerRoutineId] = useState<string>('')
  const [changeSubjectOpen, setChangeSubjectOpen] = useState(false)
  const [changeSubjectConfirmation, setChangeSubjectConfirmation] = useState('')
  const changeSubjectConfirmationTimer = useRef<number | null>(null)
  const [timerFocusTag, setTimerFocusTag] = useState<FocusTag | null>(null)
  const [timerNotes, setTimerNotes] = useState('')

  const activeSubjects = data.subjects.filter((s) => !s.deletedAt)
  const topLevelSubjects = activeSubjects.filter(isTopLevelSubject).sort((a, b) => a.name.localeCompare(b.name))
  const selectedSubject = activeSubjects.find((s) => s.id === subjectId) ?? null
  const selectedParentSubject = selectedSubject?.parentSubjectId
    ? activeSubjects.find((s) => s.id === selectedSubject.parentSubjectId) ?? null
    : selectedSubject
  const childSubjects = selectedParentSubject ? getChildSubjects(selectedParentSubject.id, activeSubjects).sort((a, b) => a.name.localeCompare(b.name)) : []
  const selectedParentId = selectedParentSubject?.id ?? ''
  const availableProjects = data.projects.filter((p) => p.subjectId === subjectId && !p.deletedAt)
  const availableTasks = data.assignments.filter((a) => a.projectId === projectId && !a.completed && !a.deletedAt)
  // Routines scheduled for today that match the selected subject (or any subject
  // when none is selected). Lets the user log timer time toward a routine.
  const todayDow = new Date().getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6
  const availableRoutines = data.routines.filter((r) => {
    if (r.deletedAt) return false
    if (!(r.dayMinutes[todayDow] ?? 0)) return false
    if (subjectId && r.subjectId !== subjectId) return false
    return true
  }).sort((a, b) => a.name.localeCompare(b.name))
  // Restore notes + routineId from persisted timer state on mount
  useEffect(() => {
    const stored = loadTimerState()
    if (stored) {
      setTimerNotes(stored.notes ?? '')
      if (stored.routineId) setTimerRoutineId(stored.routineId)
    }
  }, [])


  // Mode — try to restore from localStorage
  const [mode, setMode] = useState<Mode>(() => {
    const saved = loadTimerState()
    return saved?.mode ?? 'simple'
  })

  // Simple timer: store start timestamp (ms) instead of counter.
  // simplePausedOffset = seconds accumulated before the most recent pause.
  const [simplePausedOffset, setSimplePausedOffset] = useState(() => {
    const saved = loadTimerState()
    return saved?.mode === 'simple' ? (saved.simplePausedOffset ?? 0) : 0
  })
  const [simpleStartedAt, setSimpleStartedAt] = useState<number | null>(() => {
    const saved = loadTimerState()
    if (saved?.mode === 'simple' && saved.startedAt) return saved.startedAt
    return null
  })
  const [simpleSeconds, setSimpleSeconds] = useState(() => {
    const saved = loadTimerState()
    if (saved?.mode === 'simple' && saved.startedAt) {
      return (saved.simplePausedOffset ?? 0) + Math.floor((Date.now() - saved.startedAt) / 1000)
    }
    return saved?.mode === 'simple' ? (saved.simplePausedOffset ?? 0) : 0
  })
  const simpleIntervalRef = useRef<number | null>(null)
  // Tracks the cumulative simpleSeconds value at the time of the last session save.
  // Used to compute per-session deltas so the cumulative timer doesn't reset.
  const lastSavedCumulativeRef = useRef(0)
  // Safety guard: 12-hour runaway timer limit. Tracks whether the guard has
  // already fired for the current run so it only triggers once.
  const [safetyMessage, setSafetyMessage] = useState('')
  const simpleSafetyFiredRef = useRef(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const pomSafetyFiredRef = useRef(false)
  const [pomPhase, setPomPhase] = useState<Phase>(() => {
    const saved = loadTimerState()
    return saved?.phase ?? 'focus'
  })
  const [pomStartedAt, setPomStartedAt] = useState<number | null>(() => {
    const saved = loadTimerState()
    if (saved?.mode === 'pomodoro' && saved.startedAt) return saved.startedAt
    return null
  })
  const [pomSeconds, setPomSeconds] = useState(() => {
    const saved = loadTimerState()
    if (saved?.mode === 'pomodoro' && saved.startedAt) {
      // Compute remaining time from wall clock to avoid 00:00 → real value flicker
      const cfg = saved.config ?? settings
      const duration = getPhaseDuration(saved.phase, cfg)
      const elapsed = Math.floor((Date.now() - saved.startedAt) / 1000)
      return Math.max(0, duration - elapsed)
    }
    if (saved?.mode === 'pomodoro' && saved.phaseRemaining) return saved.phaseRemaining
    return settings.pomodoroFocusMinutes * 60
  })
  const [pomCycles, setPomCycles] = useState(() => {
    const saved = loadTimerState()
    return saved?.cyclesCompleted ?? 0
  })
  const pomIntervalRef = useRef<number | null>(null)
  // Guards the phase-transition effect against re-firing. When a phase
  // completes, the effect sets a new `pomStartedAt`/`pomPhase`; React batches
  // those updates, but the effect's deps (`pomStartedAt`, `pomSeconds`,
  // `pomPhase`) change together and the effect re-runs once more with the old
  // `pomSeconds` still 0 — saving a phantom session. We only transition when
  // `pomSeconds` genuinely counted down from a positive value to 0 (tracked
  // via the previous render's value), which also prevents auto-transitioning
  // a stale timer whose persisted remaining was already 0 on mount.
  const prevPomSecondsRef = useRef<number>(0)
  // Refs so the interval callback always sees latest values
  const configRef = useRef(config)
  configRef.current = config

  const stateRef = useRef({ pomPhase, subjectId, projectId, taskId, pomCycles })
  stateRef.current = { pomPhase, subjectId, projectId, taskId, pomCycles }
  const dataRef = useRef(data)
  dataRef.current = data
  // Tab ownership ref — keeps the latest tab-lock decision available inside
  // imperative handlers (saveSessionWithMidnightCheck, etc.) without
  // capturing a stale closure value. Assigned after the tab-lock hook runs.
  const isOwnerRef = useRef(false)
  useEffect(() => {
    if (subjectId) return
    const last = localStorage.getItem(LAST_SUBJECT_KEY)
    if (last && data.subjects.some(s => s.id === last && !s.deletedAt)) {
      setSubjectId(last)
    }
    // Don't auto-select first — leave empty
  }, [data.subjects, subjectId])

  // Recover any session that was saved to localStorage on page close but not
  // yet committed to Dexie (e.g. browser killed the tab before the async write).
  // IMPORTANT: if the timer state shows the timer was still running (startedAt set),
  // the pending session is just a crash safety snapshot of an in-progress timer,
  // NOT a completed session. Discard it to avoid duplicating the session when
  // the user stops the timer later.
  useEffect(() => {
    async function recoverPendingSession() {
      const pending = loadPendingSession()
      if (!pending) return
      clearPendingSession()
      const timerState = loadTimerState()
      if (
        timerState?.startedAt ||
        (timerState?.mode === 'simple' && (timerState.simplePausedOffset ?? 0) > 0)
      ) {
        // Timer is still in progress (running or paused). The accumulated time
        // will be included when the user resumes/stops later, so recovering the
        // pending snapshot here would duplicate that study block.
        return
      }
      const baseSession = {
        id: pending.id,
        subjectId: pending.subjectId,
        projectId: pending.projectId,
        assignmentId: pending.assignmentId,
        routineId: pending.routineId ?? null,
        startAt: pending.startAt,
        endAt: pending.endAt,
        durationMinutes: pending.durationMinutes,
        durationSeconds: pending.durationSeconds ?? pending.durationMinutes * 60,
        note: pending.note,
        source: pending.source,
        createdAt: isoNow(),
        updatedAt: isoNow(),
      }
      const splits = splitSessionAtMidnight(baseSession)
      for (const s of splits) {
        const existing = await db.sessions.get(s.id)
        if (existing && !existing.deletedAt) continue
        if (existing?.deletedAt) continue
        await db.sessions.put(s)
        const subjectName = data.subjects.find((sub) => sub.id === s.subjectId)?.name ?? 'Unknown Subject'
        syncSession(s, subjectName)
        await updateRoutineLogsForSession(s)
        await updateStreakDayForSession(s)
      }
      await loadData()
    }
    void recoverPendingSession()
  }, [])

  // Simple timer tick — compute elapsed from wall clock + paused offset
  useEffect(() => {
    if (!simpleStartedAt) {
      setSimpleSeconds(simplePausedOffset)
      return
    }
    simpleSafetyFiredRef.current = false
    const tick = () => {
      const elapsed = simplePausedOffset + Math.floor((Date.now() - simpleStartedAt) / 1000)
      setSimpleSeconds(elapsed)
      // 12-hour safety guard — warn and auto-pause if elapsed exceeds limit
      if (elapsed >= SAFETY_LIMIT_SECONDS && !simpleSafetyFiredRef.current) {
        simpleSafetyFiredRef.current = true
        const hours = Math.floor(elapsed / 3600)
        setSafetyMessage(`Timer has been running for ${hours}h. Save it to avoid data loss?`)
        sendNotification('Momentum', `Timer has been running for ${hours}h. Save it to avoid data loss?`, 'pomodoro-safety')
        pauseSimple()
      }
    }
    tick()
    const interval = window.setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [simpleStartedAt, simplePausedOffset])

  // Pomodoro timer tick — compute remaining from wall clock
  useEffect(() => {
    if (!pomStartedAt) return
    pomSafetyFiredRef.current = false
    const tick = () => {
      const saved = loadTimerState()
      const currentPhase = saved?.phase ?? pomPhase
      const duration = getPhaseDuration(currentPhase, configRef.current)
      const elapsed = Math.floor((Date.now() - pomStartedAt) / 1000)
      const remaining = Math.max(0, duration - elapsed)
      setPomSeconds(remaining)
      // 12-hour safety guard — warn and auto-pause if elapsed exceeds limit
      if (elapsed >= SAFETY_LIMIT_SECONDS && !pomSafetyFiredRef.current) {
        pomSafetyFiredRef.current = true
        const hours = Math.floor(elapsed / 3600)
        setSafetyMessage(`Timer has been running for ${hours}h. Save it to avoid data loss?`)
        sendNotification('Momentum', `Timer has been running for ${hours}h. Save it to avoid data loss?`, 'pomodoro-safety')
        pausePomodoro()
      }
    }
    tick()
    const interval = window.setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [pomStartedAt, pomPhase])

  // Pomodoro phase transition — fires when phase timer hits 0
  useEffect(() => {
    if (!pomStartedAt) return
    if (pomSeconds > 0) {
      prevPomSecondsRef.current = pomSeconds
      return
    }
    // Re-fire guard: only transition when the countdown genuinely went from
    // a positive value to 0. This blocks the duplicate effect run that React
    // schedules in the same render where we transition, and prevents
    // auto-transitioning a stale timer whose persisted remaining was already 0.
    if (prevPomSecondsRef.current <= 0) {
      return
    }
    prevPomSecondsRef.current = pomSeconds
    if (configRef.current.soundEnabled) playNotificationSound()
    sendNotification('Momentum', pomPhase === 'focus' ? 'Focus session complete — time for a break!' : 'Break over — back to focus!', 'pomodoro-phase')
    const st = stateRef.current
    const cfg = configRef.current
    const projects = dataRef.current.projects
    const assignments = dataRef.current.assignments

    if (pomPhase === 'focus') {
      // Save the completed focus session
      const actualSubjId = st.projectId ? (projects.find((p) => p.id === st.projectId)?.subjectId ?? st.subjectId) : st.subjectId
      if (actualSubjId) {
        const task = st.taskId ? assignments.find((a) => a.id === st.taskId) : undefined
        const project = st.projectId ? projects.find((p) => p.id === st.projectId) : undefined
        const end = new Date()
        const start = new Date(end.getTime() - cfg.focusMinutes * 60 * 1000)
        const startAt = start.toISOString()
        const durationMinutes = cfg.focusMinutes
        void saveSessionWithMidnightCheck({
          id: sessionIdFor(startAt, actualSubjId, durationMinutes),
          subjectId: actualSubjId,
          projectId: project?.id ?? null,
          assignmentId: task?.id ?? null,
          routineId: timerRoutineId || null,
          startAt,
          endAt: end.toISOString(),
          durationMinutes,
          durationSeconds: durationMinutes * 60,
          note: task ? `Task: ${task.title}` : undefined,
          focusTag: timerFocusTag ?? undefined,
          source: 'pomodoro',
          createdAt: isoNow(),
          updatedAt: isoNow(),
        })
        clearStreakPreviewDates()
      }
      const newCycles = st.pomCycles + 1
      setPomCycles(newCycles)
      const nextPhase = newCycles % cfg.cycles === 0 ? 'longBreak' : 'shortBreak'
      setPomPhase(nextPhase)
      const now = Date.now()
      setPomStartedAt(now)
      const newState: PersistedTimerState = {
        mode: 'pomodoro',
      subjectId: subjectId,
      simplePausedOffset: 0,
        startedAt: now,
        phaseRemaining: getPhaseDuration(nextPhase, cfg),
        phase: nextPhase,
        cyclesCompleted: newCycles,
        config: cfg,
        notes: timerNotes,
      }
      saveTimerState(newState)
    } else {
      // Break completed — go back to focus
      setPomPhase('focus')
      const now = Date.now()
      setPomStartedAt(now)
      const newState: PersistedTimerState = {
        mode: 'pomodoro',
      subjectId: subjectId,
      simplePausedOffset: 0,
        startedAt: now,
        phaseRemaining: cfg.focusMinutes * 60,
        phase: 'focus',
        cyclesCompleted: st.pomCycles,
        config: cfg,
        notes: timerNotes,
      }
      saveTimerState(newState)
    }
  }, [pomStartedAt, pomSeconds, pomPhase])
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // Cleanup on unmount: clear intervals but DON'T clear persisted state
  useEffect(() => {
    return () => {
      if (simpleIntervalRef.current) clearInterval(simpleIntervalRef.current)
      if (pomIntervalRef.current) clearInterval(pomIntervalRef.current)
      if (changeSubjectConfirmationTimer.current) clearTimeout(changeSubjectConfirmationTimer.current)
    }
  }, [])
  // Auto-save on visibility change / page close.
  // The Dexie write is async, so the browser may not wait for it before
  // killing the tab. We save a synchronous pending session to localStorage
  // FIRST so the data is never lost, then attempt the async Dexie write.
  // On next mount, the pending session is recovered and committed.
  useEffect(() => {
    function buildPendingSession(): PendingSession | null {
      // Only the owning tab may write a pending session — a peer tab would
      // otherwise create a duplicate on close.
      if (!isOwnerRef.current) return null
      if (simpleStartedAt) {
        const total = simpleSeconds
        const actualSubjId = projectId
          ? (dataRef.current.projects.find((p) => p.id === projectId && !p.deletedAt)?.subjectId ?? subjectId)
          : subjectId
        if (total >= 10 && actualSubjId) {
          const project = projectId ? dataRef.current.projects.find((p) => p.id === projectId && !p.deletedAt) : undefined
          const task = taskId ? dataRef.current.assignments.find((a) => a.id === taskId) : undefined
          const now = new Date()
          const start = new Date(now.getTime() - total * 1000)
          const startAt = start.toISOString()
          const durationSeconds = Math.max(10, Math.round(total))
          const durationMinutes = Math.max(1, Math.round(total / 60))
          return {
            id: sessionIdFor(startAt, actualSubjId, durationMinutes),
            subjectId: actualSubjId,
            projectId: project?.id ?? null,
            assignmentId: task?.id ?? null,
            routineId: timerRoutineId || null,
            startAt,
            endAt: now.toISOString(),
            durationMinutes,
            durationSeconds,
            note: task ? `Task: ${task.title}` : undefined,
            source: 'timer',
          }
        }
      } else if (pomStartedAt && pomPhase === 'focus') {
        const actualSubjId = projectId
          ? (dataRef.current.projects.find((p) => p.id === projectId && !p.deletedAt)?.subjectId ?? subjectId)
          : subjectId
        if (actualSubjId) {
          const project = projectId ? dataRef.current.projects.find((p) => p.id === projectId && !p.deletedAt) : undefined
          const task = taskId ? dataRef.current.assignments.find((a) => a.id === taskId) : undefined
          const elapsedMs = Date.now() - pomStartedAt
          const start = new Date(pomStartedAt)
          const end = new Date()
          const startAt = start.toISOString()
          const durationSeconds = Math.max(10, Math.round(elapsedMs / 1000))
          const durationMinutes = Math.max(1, Math.round(elapsedMs / 60000))
          return {
            id: sessionIdFor(startAt, actualSubjId, durationMinutes),
            subjectId: actualSubjId,
            projectId: project?.id ?? null,
            assignmentId: task?.id ?? null,
            routineId: timerRoutineId || null,
            startAt,
            endAt: end.toISOString(),
            durationMinutes,
            durationSeconds,
            note: task ? `Task: ${task.title}` : undefined,
            source: 'pomodoro',
          }
        }
      }
      return null
    }
    function handleVisibilityChange() {
      if (document.hidden) {
        // Save a pending session as crash safety net only.
        // Do NOT stop or clear the timer — the user may return.
        const pending = buildPendingSession()
        if (pending) savePendingSession(pending)
      }
    }
    function handleBeforeUnload() {
      const pending = buildPendingSession()
      if (pending) savePendingSession(pending)
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [simpleStartedAt, pomStartedAt, pomPhase, simpleSeconds, subjectId, projectId, taskId])

  // Update document.title when timer is running
  const isRunning = simpleStartedAt !== null || pomStartedAt !== null
  useEffect(() => {
    if (!isRunning) { document.title = 'Momentum'; return }
    document.title = simpleStartedAt !== null ? `${fmt(simpleSeconds)} — Momentum` : `${fmt(pomSeconds)} — Momentum`
    return () => { document.title = 'Momentum' }
  }, [isRunning, simpleSeconds, pomSeconds])

  const { isOwner, isOwnedElsewhere } = useTimerTabLock(isRunning)
  isOwnerRef.current = isOwner

  // Group presence: write our live status to all of our groups when the
  // timer is running, clear it when stopped. Subscribers in other members'
  // group-detail / timer views see the update within ~1s via Firestore.
  useEffect(() => {
    if (!isRunning) return
    const uid = localStorage.getItem('momentum-cloud-uid')
    if (!uid) return
    const name = localStorage.getItem('momentum-cloud-name') ?? 'Anonymous'
    const subjectName = data.subjects.find((s) => s.id === subjectId)?.name ?? 'Unknown'
    groupService.updatePresence(uid, name, subjectName).catch(() => {})
    return () => { groupService.clearPresence(uid).catch(() => {}) }
  }, [isRunning, subjectId, data.subjects])

  // Timer continues running in background via wall-clock computation.
  // The crash-safety save in handleVisibilityChange above handles persistence.
  useEffect(() => {
    function onDiscardSession() {
      // Only prompt if there's an active or paused session
      if (!simpleStartedAt && !simplePausedOffset && !pomStartedAt) return
      setShowDiscardConfirm(true)
    }
    window.addEventListener('momentum:discard-session', onDiscardSession)
    return () => window.removeEventListener('momentum:discard-session', onDiscardSession)
  }, [simpleStartedAt, simplePausedOffset, pomStartedAt])

  // Listen for keyboard shortcuts from Dashboard
  useEffect(() => {
    function onTimerToggle() {
      if (simpleStartedAt !== null) {
        pauseSimple()
      } else if (pomStartedAt !== null) {
        pausePomodoro()
      } else {
        // Not running — start based on current mode
        if (mode === 'simple') {
          // Match UI behavior: use resume if paused, start otherwise
          if (simplePausedOffset > 0) {
            resumeSimple()
          } else {
            // Don't start if no subject selected (match UI disabled state)
            if (subjectId || projectId) startSimple()
          }
        } else {
          // Don't start if no subject selected (match UI disabled state)
          if (subjectId || projectId) startPomodoro()
        }
      }
    }
    window.addEventListener('momentum:timer-toggle', onTimerToggle)
    return () => window.removeEventListener('momentum:timer-toggle', onTimerToggle)
  }, [simpleStartedAt, pomStartedAt, mode, subjectId, projectId, simplePausedOffset])

  useEffect(() => {
    function onStopSave() {
      if (mode === 'simple') {
        void stopSimple()
      } else {
        void resetPomodoro()
      }
    }
    window.addEventListener('momentum:timer-stop-save', onStopSave)
    return () => window.removeEventListener('momentum:timer-stop-save', onStopSave)
  }, [mode])

  function saveConfig(patch: Partial<typeof config>) {
    const updated = { ...config, ...patch }
    setConfig(updated)
    const full: Settings = {
      ...settings,
      pomodoroFocusMinutes: updated.focusMinutes,
      pomodoroBreakMinutes: updated.breakMinutes,
      pomodoroLongBreakMinutes: updated.longBreakMinutes,
      pomodoroCyclesBeforeLongBreak: updated.cycles,
      soundEnabled: updated.soundEnabled,
    }
    setSettings(full)
    saveSettings(full)
    const uid = localStorage.getItem('momentum-cloud-uid')
    if (uid) {
      const dashboardWidgets = JSON.parse(localStorage.getItem('momentum-dashboard-widgets') ?? '[]')
      const navPrefs = JSON.parse(localStorage.getItem('momentum-nav-prefs') ?? '{}')
      void pushSettings(uid, full, dashboardWidgets, navPrefs)
    }
  }

  // Simple timer
  function startSimple() {
    setSafetyMessage('')
    simpleSafetyFiredRef.current = false
    lastSavedCumulativeRef.current = 0
    void requestNotificationPermission()
    // Optimistic streak preview — show the user the streak goes up as soon
    // as they start. The real session will replace this on stop.
    setTodayPreview(true)
    void null
    const now = Date.now()
    setSimpleStartedAt(now)
    const state: PersistedTimerState = {
      mode: 'simple',
      subjectId: subjectId,
      parentSubjectId: selectedParentId || null,
      startedAt: now,
      phaseRemaining: null,
      phase: 'focus',
      cyclesCompleted: 0,
      config: configRef.current,
      simplePausedOffset: simplePausedOffset,
      notes: timerNotes,
      routineId: timerRoutineId || undefined,
    }
    saveTimerState(state)
    if (subjectId) localStorage.setItem(LAST_SUBJECT_KEY, subjectId)
    // Presence is managed centrally by the `isRunning` effect above.
  }

  function pauseSimple() {
    const elapsed = simpleSeconds
    setSimplePausedOffset(elapsed)
    setSimpleStartedAt(null)
    const state: PersistedTimerState = {
      mode: 'simple',
      subjectId: subjectId,
      parentSubjectId: selectedParentId || null,
      startedAt: null,
      phaseRemaining: null,
      phase: 'focus',
      cyclesCompleted: 0,
      config: configRef.current,
      simplePausedOffset: elapsed,
      notes: timerNotes,
      routineId: timerRoutineId || undefined,
    }
    saveTimerState(state)
    // Presence is managed centrally by the `isRunning` effect above.
  }
  function resumeSimple() {
    setSafetyMessage('')
    simpleSafetyFiredRef.current = false
    const now = Date.now()
    setSimpleStartedAt(now)
    const state: PersistedTimerState = {
      mode: 'simple',
      subjectId: subjectId,
      parentSubjectId: selectedParentId || null,
      startedAt: now,
      phaseRemaining: null,
      phase: 'focus',
      cyclesCompleted: 0,
      config: configRef.current,
      simplePausedOffset: simplePausedOffset,
      notes: timerNotes,
      routineId: timerRoutineId || undefined,
    }
    saveTimerState(state)
  }

  const { syncSession } = useSessionSync()
  /**
   * Save a session, splitting at local midnight if needed.
   * Handles Dexie write, UI sync, routine log, streak update, and reload.
   */
  function saveSessionWithMidnightCheck(session: {
    id: string
    subjectId: string
    projectId: string | null
    assignmentId: string | null
    routineId: string | null
    startAt: string
    endAt: string
    durationMinutes: number
    durationSeconds: number
    note: string | undefined
    focusTag: 'focused' | 'distracted' | 'group' | 'revision' | undefined
    source: 'timer' | 'pomodoro' | 'quickLog'
    createdAt: string
    updatedAt: string
  }) {
    // Cross-tab safety: only the owning tab may persist sessions. If a peer
    // tab is already running the same timer, skip the write to avoid
    // duplicates. Reads the latest owner ref (set via the tab lock).
    if (!isOwnerRef.current) return
    // Guard against saving a session with no subject (M3 fix).
    if (!session.subjectId) return
    // Split if crosses midnight
    const splits = splitSessionAtMidnight(session)
    // Instant UI update FIRST — show the session without waiting for DB
    mutate(prev => ({ ...prev, sessions: [...prev.sessions, ...splits] }))
    // Fire-and-forget DB + maintenance writes. Errors are logged but never block the UI.
    for (const s of splits) {
      const subjectName = data.subjects.find((sub) => sub.id === s.subjectId)?.name ?? 'Unknown Subject'
      void db.sessions.put(s).catch(err => console.error('Failed to persist session:', err))
      void updateRoutineLogsForSession(s).catch(err => console.error('Failed to update routine logs:', err))
      void updateStreakDayForSession(s).catch(err => console.error('Failed to update streak day:', err))
      syncSession(s, subjectName) // Fire-and-forget sync
    }
  }

  async function stopSimple() {
    setSimpleStartedAt(null)
    clearTimerState()
    const total = simpleSeconds
    const actualSubjectId = projectId ? (data.projects.find((p) => p.id === projectId && !p.deletedAt)?.subjectId ?? subjectId) : subjectId
    if (total >= 10 && actualSubjectId) {
      const task = taskId ? data.assignments.find((a) => a.id === taskId) : undefined
      const project = projectId ? data.projects.find((p) => p.id === projectId && !p.deletedAt) : undefined
      const now = new Date()
      const delta = total - lastSavedCumulativeRef.current
      const start = new Date(now.getTime() - delta * 1000)
      const startAt = start.toISOString()
      const durationSeconds = Math.max(10, Math.round(delta))
      const durationMinutes = Math.max(1, Math.round(delta / 60))

      saveSessionWithMidnightCheck({
        id: sessionIdFor(startAt, actualSubjectId, durationMinutes),
        subjectId: actualSubjectId,
        projectId: project?.id ?? null,
        assignmentId: task?.id ?? null,
        routineId: timerRoutineId || null,
        startAt,
        endAt: now.toISOString(),
        durationMinutes,
        durationSeconds,
        note: timerNotes || (task ? `Task: ${task.title}` : undefined),
        source: 'timer',
        focusTag: timerFocusTag ?? undefined,
        createdAt: isoNow(),
        updatedAt: isoNow(),
      })
      clearPendingSession()
    }
    lastSavedCumulativeRef.current = total
    simpleSafetyFiredRef.current = false
    setSafetyMessage('')
    setSimplePausedOffset(0)
    setSimpleSeconds(0)
    setTimerNotes('')
    localStorage.removeItem('momentum-timer-notes')
    clearStreakPreviewDates()
  }

  async function changeSubject(newSubjectId: string) {
    if (newSubjectId === subjectId) {
      setChangeSubjectOpen(false)
      return
    }
    const oldName = data.subjects.find((s) => s.id === subjectId)?.name ?? 'Unknown'
    const newName = data.subjects.find((s) => s.id === newSubjectId)?.name ?? 'Unknown'
    // Compute elapsed from the wall clock so a shortcut-triggered change
    // before a re-render still sees the correct total (M5 fix).
    const elapsed = mode === 'simple'
      ? simplePausedOffset + (simpleStartedAt ? Math.floor((Date.now() - simpleStartedAt) / 1000) : 0)
      : currentSeconds
    if (mode === 'simple') {
      // Save current simple session
      const actualSubjectId = projectId ? (data.projects.find((p) => p.id === projectId && !p.deletedAt)?.subjectId ?? subjectId) : subjectId
      if (elapsed >= 10 && actualSubjectId) {
        const task = taskId ? data.assignments.find((a) => a.id === taskId) : undefined
        const project = projectId ? data.projects.find((p) => p.id === projectId && !p.deletedAt) : undefined
        const now = new Date()
        const delta = elapsed - lastSavedCumulativeRef.current
        const start = new Date(now.getTime() - delta * 1000)
        const startAt = start.toISOString()
        const durationSeconds = Math.max(10, Math.round(delta))
        const durationMinutes = Math.max(1, Math.round(delta / 60))
        saveSessionWithMidnightCheck({
          id: sessionIdFor(startAt, actualSubjectId, durationMinutes),
          subjectId: actualSubjectId,
          projectId: project?.id ?? null,
          assignmentId: task?.id ?? null,
          routineId: timerRoutineId || null,
          startAt,
          endAt: now.toISOString(),
          durationMinutes,
          durationSeconds,
          note: task ? `Task: ${task.title}` : undefined,
          focusTag: timerFocusTag ?? undefined,
          source: 'timer',
          createdAt: isoNow(),
          updatedAt: isoNow(),
        })
      }
      clearPendingSession()
      lastSavedCumulativeRef.current = elapsed
    } else {
      // Save current pomodoro focus session (only if focus phase and has been running)
      if (pomPhase === 'focus' && pomStartedAt) {
        const actualSubjId = projectId ? (data.projects.find((p) => p.id === projectId && !p.deletedAt)?.subjectId ?? subjectId) : subjectId
        if (actualSubjId) {
          const task = taskId ? data.assignments.find((a) => a.id === taskId) : undefined
          const project = projectId ? data.projects.find((p) => p.id === projectId && !p.deletedAt) : undefined
        const startMs = pomStartedAt
        const rawElapsedMs = Date.now() - startMs
        // Cap at configured focus duration so a paused timer that was resumed
        // much later doesn't report hours of focus time (M2 fix).
        const elapsedMs = Math.min(rawElapsedMs, configRef.current.focusMinutes * 60_000)
        const partialSeconds = Math.max(1, Math.round(elapsedMs / 1000))
        const partialMinutes = Math.max(1, Math.round(elapsedMs / 60000))
          const start = new Date(startMs)
          const end = new Date()
          const startAt = start.toISOString()
          saveSessionWithMidnightCheck({
            id: sessionIdFor(startAt, actualSubjId, partialMinutes),
            subjectId: actualSubjId,
            projectId: project?.id ?? null,
            assignmentId: task?.id ?? null,
            routineId: timerRoutineId || null,
            startAt,
            endAt: end.toISOString(),
            durationMinutes: partialMinutes,
            durationSeconds: partialSeconds,
            note: task ? `Task: ${task.title}` : undefined,
            focusTag: timerFocusTag ?? undefined,
            source: 'pomodoro',
            createdAt: isoNow(),
            updatedAt: isoNow(),
          })
        }
      }
      clearPendingSession()
    }
    // Switch subject and start new session
    setSubjectId(newSubjectId)
    setProjectId('')
    setTaskId('')
    const now = Date.now()
    if (mode === 'simple') {
      const state: PersistedTimerState = {
        mode: 'simple',
        subjectId: newSubjectId,
        parentSubjectId: selectedParentId || null,
        simplePausedOffset: 0,
        startedAt: now,
        phaseRemaining: null,
        phase: 'focus',
        cyclesCompleted: 0,
        config: configRef.current,
        notes: timerNotes,
        routineId: timerRoutineId || undefined,
      }
      saveTimerState(state)
    } else {
      setPomStartedAt(now)
      const state: PersistedTimerState = {
        mode: 'pomodoro',
        subjectId: newSubjectId,
        parentSubjectId: selectedParentId || null,
        simplePausedOffset: 0,
        startedAt: now,
        phaseRemaining: getPhaseDuration(pomPhase, configRef.current),
        phase: pomPhase,
        cyclesCompleted: pomCycles,
        config: configRef.current,
        notes: timerNotes,
        routineId: timerRoutineId || undefined,
      }
      saveTimerState(state)
    }
    localStorage.setItem(LAST_SUBJECT_KEY, newSubjectId)
    setChangeSubjectOpen(false)
    setChangeSubjectConfirmation(`Switched from ${oldName} to ${newName}`)
    if (changeSubjectConfirmationTimer.current) clearTimeout(changeSubjectConfirmationTimer.current)
    changeSubjectConfirmationTimer.current = window.setTimeout(() => setChangeSubjectConfirmation(''), 3000)
  }

  function startPomodoro() {
    setSafetyMessage('')
    pomSafetyFiredRef.current = false
    void requestNotificationPermission()
    setTodayPreview(true)
    const now = Date.now()
    setPomStartedAt(now)
    const state: PersistedTimerState = {
      mode: 'pomodoro',
      subjectId: subjectId,
      parentSubjectId: selectedParentId || null,
      simplePausedOffset: 0,
      startedAt: now,
      phaseRemaining: getPhaseDuration(pomPhase, configRef.current),
      phase: pomPhase,
      cyclesCompleted: pomCycles,
      config: configRef.current,
      notes: timerNotes,
      routineId: timerRoutineId || undefined,
    }
    saveTimerState(state)
    if (subjectId) localStorage.setItem(LAST_SUBJECT_KEY, subjectId)
  }
  function pausePomodoro() {
    pomSafetyFiredRef.current = false
    setPomStartedAt(null)
    const state: PersistedTimerState = {
      mode: 'pomodoro',
      subjectId: subjectId,
      parentSubjectId: selectedParentId || null,
      simplePausedOffset: 0,
      startedAt: null,
      phaseRemaining: pomSeconds,
      phase: pomPhase,
      cyclesCompleted: pomCycles,
      config: configRef.current,
      notes: timerNotes,
      routineId: timerRoutineId || undefined,
    }
    saveTimerState(state)
  }

  async function resetPomodoro() {
    setSafetyMessage('')
    pomSafetyFiredRef.current = false
    // Save partial focus session before discarding
    if (pomPhase === 'focus' && pomStartedAt) {
      const actualSubjId = projectId ? (data.projects.find((p) => p.id === projectId && !p.deletedAt)?.subjectId ?? subjectId) : subjectId
      if (actualSubjId) {
        const task = taskId ? data.assignments.find((a) => a.id === taskId) : undefined
        const project = projectId ? data.projects.find((p) => p.id === projectId && !p.deletedAt) : undefined
        const startMs = pomStartedAt
        const elapsedMs = Date.now() - startMs
        const partialSeconds = Math.max(10, Math.round(elapsedMs / 1000))
        const partialMinutes = Math.max(1, Math.round(elapsedMs / 60000))
        const start = new Date(startMs)
        const end = new Date()
        const startAt = start.toISOString()
        saveSessionWithMidnightCheck({
          id: sessionIdFor(startAt, actualSubjId, partialMinutes),
          subjectId: actualSubjId,
          projectId: project?.id ?? null,
          assignmentId: task?.id ?? null,
          routineId: timerRoutineId || null,
          startAt,
          endAt: end.toISOString(),
          durationMinutes: partialMinutes,
          durationSeconds: partialSeconds,
          note: timerNotes || (task ? `Task: ${task.title}` : undefined),
          source: 'pomodoro',
          focusTag: timerFocusTag ?? undefined,
          createdAt: isoNow(),
          updatedAt: isoNow(),
        })
          clearPendingSession()
      }
    }
    setPomStartedAt(null)
    clearTimerState()
    setPomPhase('focus')
    setPomCycles(0)
    setPomSeconds(config.focusMinutes * 60)
    setTimerNotes('')
    localStorage.removeItem('momentum-timer-notes')
    clearStreakPreviewDates()
  }
  function discardSession() {
    setSimpleStartedAt(null)
    setSimplePausedOffset(0)
    setSimpleSeconds(0)
    setPomStartedAt(null)
    setPomSeconds(config.focusMinutes * 60)
    setPomPhase('focus')
    setPomCycles(0)
    setSafetyMessage('')
    setShowDiscardConfirm(false)
    clearPendingSession()
    clearStreakPreviewDates()
    clearTimerState()
    setTimerFocusTag(null)
    setTimerNotes('')
    localStorage.removeItem('momentum-timer-notes')
  }

  const currentSeconds = mode === 'simple' ? simpleSeconds : pomSeconds
  const cycleLabel = mode === 'pomodoro' && settings.pomodoroEnabled
    ? `Cycle ${(pomCycles % config.cycles) + 1} of ${config.cycles}`
    : ''
  const isTimerActive = simpleStartedAt != null || pomStartedAt != null
  // YPT-style: total minutes studied today (committed sessions + current live session)
  const totalTodayMinutes = useMemo(() => {
    return getTotalTodayMinutes(data.sessions, data.subjects, data.categories)
  }, [data.sessions, data.subjects, data.categories, simpleSeconds])


  return (
    <Card>
      {/* Header — only show when timer is idle */}
      {!isTimerActive && (
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>⏱️ Study Timer</CardTitle>
            {mode === 'pomodoro' && settings.pomodoroEnabled && (
              <button
                onClick={() => { setShowConfig(!showConfig) }}
                className={cn(
                  'rounded p-1.5 text-sm transition-colors',
                  'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300'
                )}
                title="Configure pomodoro"
              >
                ⚙️
              </button>
            )}
          </div>
        </CardHeader>
      )}
      {/* Config panel (gear) */}
      {showConfig && mode === 'pomodoro' && !isTimerActive && (
        <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800/50">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Focus</label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={String(config.focusMinutes)}
                  onChange={(e) => { const v = e.target.value; if (v === '') { saveConfig({ focusMinutes: 1 }); return }; const n = Number(v); if (isNaN(n)) return; saveConfig({ focusMinutes: Math.max(1, n) }) }}
                  className="input w-16 text-center"
                />
                <span className="text-xs text-slate-500">min</span>
              </div>
            </div>
            <div>
              <label className="label">Short Break</label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={String(config.breakMinutes)}
                  onChange={(e) => { const v = e.target.value; if (v === '') { saveConfig({ breakMinutes: 1 }); return }; const n = Number(v); if (isNaN(n)) return; saveConfig({ breakMinutes: Math.max(1, n) }) }}
                  className="input w-16 text-center"
                />
                <span className="text-xs text-slate-500">min</span>
              </div>
            </div>
            <div>
              <label className="label">Long Break</label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={String(config.longBreakMinutes)}
                  onChange={(e) => { const v = e.target.value; if (v === '') { saveConfig({ longBreakMinutes: 1 }); return }; const n = Number(v); if (isNaN(n)) return; saveConfig({ longBreakMinutes: Math.max(1, n) }) }}
                  className="input w-16 text-center"
                />
                <span className="text-xs text-slate-500">min</span>
              </div>
            </div>
            <div>
              <label className="label">Cycles</label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  max={12}
                  value={String(config.cycles)}
                  onChange={(e) => { const v = e.target.value; if (v === '') { saveConfig({ cycles: 1 }); return }; const n = Number(v); if (isNaN(n)) return; saveConfig({ cycles: Math.max(1, Math.min(12, n)) }) }}
                  className="input w-16 text-center"
                />
                <span className="text-xs text-slate-500">× then long</span>
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">Sound</span>
            <button
              onClick={() => saveConfig({ soundEnabled: !config.soundEnabled })}
              className={cn(
                'relative h-5 w-9 rounded-full transition-colors',
                config.soundEnabled ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                  config.soundEnabled && 'translate-x-4'
                )}
              />
            </button>
          </div>
          <p className="mt-2 text-[10px] text-slate-400">
            Also editable in <a href="/settings" className="underline">Settings</a>
          </p>
        </div>
      )}
      {/* Mode toggle — only show when idle */}
      {!isTimerActive && (
        <div className="mb-3 flex gap-2">
          <button
            onClick={() => setMode('simple')}
            className={cn(
              'flex-1 rounded px-2 py-1 text-sm font-medium transition-colors',
              mode === 'simple'
                ? 'bg-primary-600 text-white'
                : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
            )}
          >
            Simple
          </button>
          {settings.pomodoroEnabled && (
            <button
              onClick={() => setMode('pomodoro')}
              className={cn(
                'flex-1 rounded px-2 py-1 text-sm font-medium transition-colors',
                mode === 'pomodoro'
                  ? 'bg-primary-600 text-white'
                  : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
              )}
            >
              Pomodoro
            </button>
          )}
        </div>
      )}

      {/* Phase indicator */}
      {mode === 'pomodoro' && settings.pomodoroEnabled && (
        <div className="mb-3 text-center text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {cycleLabel}
        </div>
      )}
      {/* Break indicator */}
      {mode === 'pomodoro' && settings.pomodoroEnabled && (pomPhase === 'shortBreak' || pomPhase === 'longBreak') && (
        <div className="mb-3 text-center text-sm text-slate-600 dark:text-slate-300">
          {pomPhase === 'shortBreak' ? 'Short' : 'Long'} break{data.subjects.find((s) => s.id === subjectId)?.name ? ` from ${data.subjects.find((s) => s.id === subjectId)?.name}` : ''}
        </div>
      )}
      {/* Safety message — 12-hour runaway timer warning */}
      {safetyMessage && (
        <div className="mb-3 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-center text-sm text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
          <p>{safetyMessage}</p>
          <Button
            variant="danger"
            className="mt-2"
            onClick={() => {
              if (mode === 'simple') {
                void stopSimple()
              } else {
                void resetPomodoro()
              }
            }}
          >
            Save Now
          </Button>
        </div>
      )}

      {/* Timer display — always visible */}
      <div className="text-center text-5xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
        {fmt(currentSeconds)}
      </div>

      {/* Cycle dots + recent sessions — only when idle in pomodoro mode */}
      {!isTimerActive && mode === 'pomodoro' && settings.pomodoroEnabled && (
        <>
          <div className="mt-2 flex justify-center gap-2">
            {Array.from({ length: config.cycles }, (_, i) => {
              const completedCycles = pomCycles % config.cycles
              const completed = i < completedCycles
              return (
                <div
                  key={i}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2',
                    completed
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-slate-300 dark:border-slate-600'
                  )}
                >
                  {completed ? i + 1 : ''}
                </div>
              )
            })}
          </div>
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recent Sessions</h3>
            <div className="space-y-2">
              {data.sessions.filter((s) => s.source === 'pomodoro').slice(0, 3).map((session) => {
                const subject = data.subjects.find((s) => s.id === session.subjectId)
                return (
                  <div key={session.id} className="flex items-center gap-2 text-xs">
                    <div
                      className={cn(
                        'h-2 w-2 rounded-full',
                        subject?.color ?? 'bg-slate-400'
                      )}
                    />
                    <span className="truncate text-slate-700 dark:text-slate-300">{subject?.name ?? 'Unknown'}</span>
                    <span className="text-slate-500 dark:text-slate-400">{session.durationMinutes}m</span>
                    <span className="ml-auto text-slate-400">{format(new Date(session.startAt), 'h:mm a')}</span>
                  </div>
                )
              })}
              {data.sessions.filter((s) => s.source === 'pomodoro').length === 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-500">No sessions yet</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Subject selectors (idle) / compact info + controls (active) */}
      <div className="mt-3 space-y-2">
        {!isTimerActive ? (
          <>
            <div>
              <label className="label">Focus Area</label>
              <select
                className="input"
                value={selectedParentId}
                onChange={(e) => { setSubjectId(e.target.value); setProjectId(''); setTaskId('') }}
              >
                <option value="">— Select focus area —</option>
                {topLevelSubjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            {selectedParentId && childSubjects.length > 0 && (
              <div>
                <label className="label">Sub-focus Area</label>
                <select
                  className="input"
                  value={subjectId}
                  onChange={(e) => { setSubjectId(e.target.value); setProjectId(''); setTaskId('') }}
                >
                  <option value={selectedParentId}>General / overall subject</option>
                  {childSubjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            {subjectId && availableProjects.length > 0 && (
              <div>
                <label className="label">Project (optional)</label>
                <select
                  className="input"
                  value={projectId}
                  onChange={(e) => { setProjectId(e.target.value); setTaskId('') }}
                >
                  <option value="">— Select project —</option>
                  {availableProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            {projectId && availableTasks.length > 0 && (
              <div>
                <label className="label">Task (optional)</label>
                <select
                  className="input"
                  value={taskId}
                  onChange={(e) => setTaskId(e.target.value)}
                >
                  <option value="">— Select task —</option>
                  {availableTasks.map((a) => (
                    <option key={a.id} value={a.id}>{a.title}</option>
                  ))}
                </select>
              </div>
            )}
            {availableRoutines.length > 0 && (
              <div>
                <label className="label">Routine (optional)</label>
                <select
                  className="input"
                  value={timerRoutineId}
                  onChange={(e) => setTimerRoutineId(e.target.value)}
                >
                  <option value="">— No routine —</option>
                  {availableRoutines.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}
            <TimerNotesAndTag
              notes={timerNotes}
              onNotesChange={(v) => {
                setTimerNotes(v)
                const state = loadTimerState()
                if (state) saveTimerState({ ...state, notes: v })
              }}
              focusTag={timerFocusTag}
              onFocusTagChange={setTimerFocusTag}
            />
            <div className="flex justify-center gap-2 mt-3">
              {isOwnedElsewhere ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">Timer is running in another tab — controls disabled here</p>
              ) : mode === 'simple' ? (
                <Button variant="primary" onClick={startSimple} disabled={!subjectId && !projectId}>
                  Start
                </Button>
              ) : (
                <>
                  <Button variant="primary" onClick={startPomodoro} disabled={!subjectId && !projectId}>
                    Start
                  </Button>
                  <DiscardButton
                    showConfirm={showDiscardConfirm}
                    onShowConfirm={() => setShowDiscardConfirm(true)}
                    onCancel={() => setShowDiscardConfirm(false)}
                    onConfirm={discardSession}
                  />
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="text-sm text-slate-600 dark:text-slate-300">
              Studying <span className="font-semibold">{getSubjectPathLabel(subjectId, data.subjects)}</span>
            </div>
            <TimerNotesAndTag
              notes={timerNotes}
              onNotesChange={(v) => {
                setTimerNotes(v)
                const state = loadTimerState()
                if (state) saveTimerState({ ...state, notes: v })
              }}
              focusTag={timerFocusTag}
              onFocusTagChange={setTimerFocusTag}
            />
            {mode === 'simple' && (
              <div className="text-center text-xs text-slate-500 dark:text-slate-400">
                Total today: <span className="font-semibold text-slate-700 dark:text-slate-300">{formatTotalToday(totalTodayMinutes, true)}</span>
              </div>
            )}
            <div className="flex justify-center gap-2">
              {isOwnedElsewhere ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">Timer is running in another tab — controls disabled here</p>
              ) : (
                <>
                  {simpleStartedAt !== null ? (
                    <Button variant="secondary" onClick={pauseSimple}>Pause</Button>
                  ) : pomStartedAt !== null ? (
                    <Button variant="secondary" onClick={pausePomodoro}>Pause</Button>
                  ) : (
                    <Button variant="primary" onClick={mode === 'simple' ? resumeSimple : () => {}}>Resume</Button>
                  )}
                  <Button variant="danger" onClick={mode === 'simple' ? () => void stopSimple() : () => void resetPomodoro()}>
                    Stop &amp; Save
                  </Button>
                  <DiscardButton
                    showConfirm={showDiscardConfirm}
                    onShowConfirm={() => setShowDiscardConfirm(true)}
                    onCancel={() => setShowDiscardConfirm(false)}
                    onConfirm={discardSession}
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>
      {/* Change Subject — only when timer is running */}
      {isTimerActive && (
        <div className="mt-2 flex flex-col items-center gap-1">
          {!changeSubjectOpen ? (
            <button
              type="button"
              onClick={() => setChangeSubjectOpen(true)}
              className="text-xs text-primary-600 hover:underline dark:text-primary-400"
            >
              Change Subject
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <select
                className="input w-48"
                value={subjectId}
                onChange={(e) => { void changeSubject(e.target.value) }}
                autoFocus
              >
                <option value="">— Select new subject —</option>
                {data.subjects.filter((s) => s.id !== subjectId && !s.deletedAt).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setChangeSubjectOpen(false)}
                className="text-xs text-slate-500 hover:underline"
              >
                Cancel
              </button>
            </div>
          )}
          {changeSubjectConfirmation && (
            <p className="text-xs text-green-600 dark:text-green-400">{changeSubjectConfirmation}</p>
          )}
        </div>
      )}

      {!settings.pomodoroEnabled && (
        <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
          Pomodoro hidden — enable in <a href="/settings" className="underline">Settings</a>
        </p>
      )}
    </Card>
  )
}
