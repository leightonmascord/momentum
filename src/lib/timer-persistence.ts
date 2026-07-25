// Timer persistence — keeps the study timer running across navigation and page refreshes.
// We store a start timestamp in localStorage and compute elapsed time from the wall clock,
// so the timer is accurate regardless of when the component mounts/unmounts.
const STORAGE_KEY = 'momentum-timer-state'
/** Key for a session that was saved synchronously on page close but not yet
 * committed to Dexie. The PomodoroTimer component checks this on mount and
 * saves it to Dexie asynchronously. */
const PENDING_SESSION_KEY = 'momentum-pending-session'


/** Generate a deterministic session ID from its content fields.
 *  Two sessions with the same startAt, subjectId, and durationMinutes
 *  will produce the same ID, making db.sessions.put() idempotent. */
export function sessionIdFor(startAt: string, subjectId: string, durationMinutes: number): string {
  const key = `${startAt}|${subjectId}|${durationMinutes}`
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `s-${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`
}
export interface PendingSession {
  id: string
  subjectId: string
  projectId: string | null
  assignmentId: string | null
  startAt: string
  endAt: string
  durationMinutes: number
  durationSeconds?: number
  note: string | undefined
  source: 'timer' | 'pomodoro'
}

export function savePendingSession(session: PendingSession): void {
  try {
    localStorage.setItem(PENDING_SESSION_KEY, JSON.stringify(session))
  } catch { /* ignore */ }
}

export function loadPendingSession(): PendingSession | null {
  try {
    const raw = localStorage.getItem(PENDING_SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PendingSession
  } catch { return null }
}

export function clearPendingSession(): void {
  try { localStorage.removeItem(PENDING_SESSION_KEY) } catch { /* ignore */ }
}

export type TimerMode = 'simple' | 'pomodoro'
export type TimerPhase = 'focus' | 'shortBreak' | 'longBreak'

export interface TimerConfig {
  focusMinutes: number
  breakMinutes: number
  longBreakMinutes: number
  cycles: number
}

export interface PersistedTimerState {
  mode: TimerMode
  /** Start timestamp (ms since epoch) of the CURRENT phase. Null if paused. */
  startedAt: number | null
  /** Remaining seconds when paused (null if running). */
  phaseRemaining: number | null
  /** Pomodoro-only fields */
  phase: TimerPhase
  cyclesCompleted: number
  config: TimerConfig
  /** Simple timer: total seconds accumulated before the most recent pause (0 if not paused). */
  simplePausedOffset: number
  subjectId?: string
  parentSubjectId?: string | null
  /** Notes about what the user is studying. */
  notes?: string
  /** Focus quality tag for the active session. */
  focusTag?: 'focused' | 'distracted' | 'group' | 'revision'
}
export function saveTimerState(state: PersistedTimerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage may be unavailable
  }
}

export function loadTimerState(): PersistedTimerState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedTimerState
    if (!parsed.mode) return null
    return parsed
  } catch {
    return null
  }
}

export function clearTimerState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** Get the start of the next day (midnight) in local time, as ms since epoch. */
function getLocalMidnightMs(date: Date): number {
  const d = new Date(date)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

/**
 * Check if a session crosses local midnight. If so, split it into two sessions:
 * one ending at midnight, one starting at midnight.
 * Returns an array of one or two session-like objects.
 *
 * Both sessions get the same subjectId, projectId, source, note, assignmentId.
 */
export function splitSessionAtMidnight(
  session: {
    id: string
    subjectId: string
    projectId: string | null
    assignmentId: string | null
    startAt: string
    endAt: string
    durationMinutes: number
    durationSeconds?: number
    note: string | undefined
    focusTag?: 'focused' | 'distracted' | 'group' | 'revision'
    source: 'timer' | 'pomodoro' | 'quickLog'
    createdAt: string
    updatedAt: string
  }
): Array<{
  id: string
  subjectId: string
  projectId: string | null
  assignmentId: string | null
  startAt: string
  endAt: string
  durationMinutes: number
  durationSeconds: number
  note: string | undefined
  source: 'timer' | 'pomodoro' | 'quickLog'
  focusTag?: 'focused' | 'distracted' | 'group' | 'revision'
  createdAt: string
  updatedAt: string
}> {
  const start = new Date(session.startAt)
  const end = new Date(session.endAt)
  const startDay = formatLocalDate(start)
  const endDay = formatLocalDate(end)

  // Same day — no split needed
  if (startDay === endDay) {
    return [{
      ...session,
      durationSeconds: session.durationSeconds ?? session.durationMinutes * 60,
    }]
  }

  const midnightMs = getLocalMidnightMs(start)
  const midnightDate = new Date(midnightMs)
  const totalMs = end.getTime() - start.getTime()
  const beforeMidnightMs = midnightMs - start.getTime()
  const afterMidnightMs = totalMs - beforeMidnightMs

  const beforeMinutes = Math.max(1, Math.round(beforeMidnightMs / 60000))
  const beforeSeconds = Math.max(10, Math.round(beforeMidnightMs / 1000))
  const afterMinutes = Math.max(1, Math.round(afterMidnightMs / 60000))
  const afterSeconds = Math.max(10, Math.round(afterMidnightMs / 1000))

  const beforeId = sessionIdFor(session.startAt, session.subjectId, beforeMinutes)
  const afterId = sessionIdFor(midnightDate.toISOString(), session.subjectId, afterMinutes)

  return [
    {
      id: beforeId,
      subjectId: session.subjectId,
      projectId: session.projectId,
      assignmentId: session.assignmentId,
      startAt: session.startAt,
      endAt: midnightDate.toISOString(),
      durationMinutes: beforeMinutes,
      durationSeconds: beforeSeconds,
      note: session.note,
      source: session.source,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
    {
      id: afterId,
      subjectId: session.subjectId,
      projectId: session.projectId,
      assignmentId: session.assignmentId,
      startAt: midnightDate.toISOString(),
      endAt: session.endAt,
      durationMinutes: afterMinutes,
      durationSeconds: afterSeconds,
      note: session.note,
      source: session.source,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
  ]
}

/** Format a date as yyyy-MM-dd in local timezone. */
function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
