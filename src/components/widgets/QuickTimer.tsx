import { useEffect, useRef, useState } from 'react'
import { db } from '../../db/app-db'
import type { Session } from '../../domain/types'
import { Button } from '../ui/Button'
import { Card, CardHeader, CardTitle } from '../ui/Card'
import { useData } from '../../app/providers'
import { useSessionSync } from '../../lib/use-session-sync'
import { updateRoutineLogsForSession, updateStreakDayForSession } from '../../lib/routine-tracker'
import { isoNow, getSubjectPickerOptions, cn } from '../../lib/utils'
import { sessionIdFor } from '../../lib/timer-persistence'
import { sendNotification, requestNotificationPermission } from '../../lib/notification-service'

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const STORAGE_KEY = 'momentum-quick-timer'
interface PersistedTimer {
  running: boolean
  seconds: number
  label: string
  subjectId: string
  focusTag?: Session['focusTag'] | null
  startedAt: number | null // ms epoch when the timer last started/resumed
}
function emptyPersisted(): PersistedTimer {
  return { running: false, seconds: 0, label: '', subjectId: '', focusTag: null, startedAt: null }
}
function loadPersisted(): PersistedTimer {
  if (typeof localStorage === 'undefined') return emptyPersisted()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyPersisted()
    const parsed = JSON.parse(raw) as PersistedTimer
    if (parsed.running && parsed.startedAt) {
      const elapsed = Math.floor((Date.now() - parsed.startedAt) / 1000)
      parsed.seconds += Math.max(0, elapsed)
      parsed.startedAt = Date.now()
    }
    return parsed
  } catch {
    return emptyPersisted()
  }
}
function savePersisted(state: PersistedTimer) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* ignore */ }
}

export default function QuickTimer() {
  const { data, mutate } = useData()
  const { syncSession } = useSessionSync()
  const [running, setRunning] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [label, setLabel] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [focusTag, setFocusTag] = useState<Session['focusTag'] | null>(null)
  const intervalRef = useRef<number | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const stopInFlightRef = useRef(false)

  useEffect(() => {
    const persisted = loadPersisted()
    setRunning(persisted.running)
    setSeconds(persisted.seconds)
    setLabel(persisted.label)
    setSubjectId(persisted.subjectId)
    setFocusTag(persisted.focusTag ?? null)
    if (persisted.running && persisted.startedAt) {
      startedAtRef.current = persisted.startedAt
    }
  }, [])

  // Simple timer tick - compute display from wall clock
  useEffect(() => {
    if (!running || startedAtRef.current === null) return

    intervalRef.current = window.setInterval(() => {
      // Trigger a re-render so displaySeconds recomputes from wall clock.
      setSeconds((prev) => prev)
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [running])

  // Persist whenever persisted state changes. Drop `seconds` from deps so we
  // don't write localStorage on every tick (L8 fix).
  useEffect(() => {
    savePersisted({ running, seconds, label, subjectId, focusTag, startedAt: running ? startedAtRef.current : null })
  }, [running, label, subjectId, focusTag])
  function start() {
    startedAtRef.current = Date.now()
    setFocusTag(null)
    setRunning(true)
    void requestNotificationPermission()
  }

  async function stop() {
    if (stopInFlightRef.current) return
    stopInFlightRef.current = true
    try {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
      setRunning(false)

      const now = Date.now()
      const elapsedSinceStart = startedAtRef.current !== null ? Math.floor((now - startedAtRef.current) / 1000) : 0
      const total = seconds + elapsedSinceStart
      if (total < 10) return
      let subject = data.subjects.find((s) => s.id === subjectId && !s.deletedAt)
      if (!subject) {
        window.alert('No valid focus area selected. Your session was not saved.')
        return
      }
      const nowDate = new Date()
      const start = new Date(nowDate.getTime() - total * 1000)
      const startAt = start.toISOString()
      const durationMinutes = Math.max(1, Math.round(total / 60))
      const durationSeconds = Math.max(10, Math.round(total))
      const session: Session = {
        id: sessionIdFor(startAt, subject.id, durationMinutes),
        subjectId: subject.id,
        projectId: null,
        assignmentId: null,
        startAt,
        endAt: nowDate.toISOString(),
        durationMinutes,
        durationSeconds,
        note: label || undefined,
        source: 'timer',
        ...(focusTag ? { focusTag } : {}),
        createdAt: isoNow(),
        updatedAt: isoNow(),
      }
      // Instant UI update FIRST
      startedAtRef.current = null
      setSeconds(0)
      setFocusTag(null)
      setLabel('')
      mutate(prev => ({ ...prev, sessions: [...prev.sessions, session] }))
      // Fire-and-forget DB writes
      void db.sessions.put(session).catch(err => console.error('Failed to persist session:', err))
      void updateRoutineLogsForSession(session).catch(err => console.error('Failed to update routine logs:', err))
      void updateStreakDayForSession(session).catch(err => console.error('Failed to update streak day:', err))
      syncSession(session, subject.name)
      sendNotification('Momentum', `Session saved: ${subject.name} — ${durationMinutes}m`, 'session-saved')
    } finally {
      stopInFlightRef.current = false
    }
  }

  function reset() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
    setRunning(false)
    setSeconds(0)
    setLabel('')
    setSubjectId('')
    startedAtRef.current = null
    setFocusTag(null)
  }

  // Compute display seconds: base accumulated + wall-clock elapsed since last start
  const displaySeconds = running && startedAtRef.current !== null
    ? seconds + Math.floor((Date.now() - startedAtRef.current) / 1000)
    : seconds

  const recentSessions = data.sessions
    .filter((s) => s.source === 'timer' && s.note && !s.deletedAt)
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())
    .slice(0, 5)

  return (
    <Card>
      <CardHeader>
        <CardTitle>⏱️ Quick Timer</CardTitle>
      </CardHeader>
      <div className="space-y-3">
        <select
          className="input w-full"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          disabled={running}
        >
          {data.subjects.length === 0 && <option value="">No subjects yet</option>}
          {!subjectId && data.subjects.length > 0 && <option value="" disabled>Select a subject…</option>}
          {getSubjectPickerOptions(data.subjects).map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <input
          className="input w-full"
          placeholder="Optional label (e.g. Math Test)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={running}
        />
        <div className="text-center text-5xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
          {fmt(displaySeconds)}
        </div>
        <div className="flex gap-1 flex-wrap" role="group" aria-label="Focus tag">
          {(['focused', 'distracted', 'group', 'revision'] as const).map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setFocusTag(focusTag === tag ? null : tag)}
              className={cn(
                'rounded-full px-2 py-0.5 text-xs border',
                focusTag === tag
                  ? 'border-primary-500 bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200'
                  : 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400'
              )}
            >
              {tag}
            </button>
          ))}
        </div>
        <div className="flex justify-center gap-2">
          {!running ? (
            <Button variant="primary" onClick={start}>Start</Button>
          ) : (
            <Button variant="danger" onClick={stop}>Stop & Save</Button>
          )}
          <Button variant="secondary" onClick={reset}>Reset</Button>
        </div>
      </div>
      {recentSessions.length > 0 && (
        <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
          <h4 className="text-sm font-medium text-slate-500 dark:text-slate-400">Recent</h4>
          <div className="mt-2 space-y-1">
            {recentSessions.map((s) => (
              <div key={s.id} className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                <span>{s.note}</span>
                <span>{s.durationMinutes}m</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
