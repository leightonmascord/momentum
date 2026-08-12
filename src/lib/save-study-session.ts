import { db } from '../db/app-db'
import { isoNow, sessionLocalDate } from './utils'
import { sessionIdFor } from './timer-persistence'
import { updateRoutineLogsForSession, updateStreakDayForSession } from './routine-tracker'
import type { Session } from '../domain/types'

export interface SaveStudySessionInput {
  startAt: string
  endAt: string
  durationMinutes: number
  durationSeconds?: number
  subjectId: string
  projectId?: string | null
  assignmentId?: string | null
  routineId?: string | null
  note?: string
  source: Session['source']
  focusTag?: Session['focusTag']
  id?: string
  createdAt?: string
}

export async function saveStudySession(input: SaveStudySessionInput): Promise<Session> {
  const id = input.id ?? sessionIdFor(input.startAt, input.subjectId, input.durationMinutes)
  const session: Session = {
    id,
    subjectId: input.subjectId,
    projectId: input.projectId ?? null,
    assignmentId: input.assignmentId ?? null,
    routineId: input.routineId ?? null,
    startAt: input.startAt,
    endAt: input.endAt,
    durationMinutes: input.durationMinutes,
    durationSeconds: input.durationSeconds,
    note: input.note,
    source: input.source,
    focusTag: input.focusTag,
    createdAt: input.createdAt ?? isoNow(),
    updatedAt: isoNow(),
  }
  await db.sessions.put(session)
  await updateRoutineLogsForSession(session)
  await updateStreakDayForSession(session)
  return session
}

/** Detect sessions that overlap a given time range for the same subject. */
export function findOverlappingSessions(
  sessions: Session[],
  startAt: string,
  endAt: string,
  subjectId: string,
  excludeId?: string
): Session[] {
  const sStart = new Date(startAt).getTime()
  const sEnd = new Date(endAt).getTime()
  return sessions.filter((s) => {
    if (s.deletedAt) return false
    if (s.id === excludeId) return false
    if (s.subjectId !== subjectId) return false
    const oStart = new Date(s.startAt).getTime()
    const oEnd = new Date(s.endAt).getTime()
    return oStart < sEnd && oEnd > sStart
  })
}

/** Per-subject minute breakdown for today. */
export interface SubjectBreakdown {
  subjectId: string
  subjectName: string
  minutes: number
  color: string
}

export function buildTodaySubjectBreakdown(
  sessions: Session[],
  subjects: { id: string; name: string; color: string; deletedAt?: string | null }[],
  todayStr: string,
  liveSubjectId?: string | null,
  liveMinutes?: number
): SubjectBreakdown[] {
  const map = new Map<string, SubjectBreakdown>()
  for (const s of sessions) {
    if (s.deletedAt) continue
    if (sessionLocalDate(s.startAt) !== todayStr) continue
    const subj = subjects.find((x) => x.id === s.subjectId && !x.deletedAt)
    if (!subj) continue
    const existing = map.get(s.subjectId)
    const minutes = (existing?.minutes ?? 0) + s.durationMinutes
    map.set(s.subjectId, { subjectId: s.subjectId, subjectName: subj.name, minutes, color: subj.color })
  }
  if (liveSubjectId && liveMinutes && liveMinutes > 0) {
    const subj = subjects.find((x) => x.id === liveSubjectId && !x.deletedAt)
    if (subj) {
      const existing = map.get(liveSubjectId)
      const minutes = (existing?.minutes ?? 0) + liveMinutes
      map.set(liveSubjectId, { subjectId: liveSubjectId, subjectName: subj.name, minutes, color: subj.color })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.minutes - a.minutes)
}
