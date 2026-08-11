// Auto-tracking: when a study session is saved, update today's RoutineLog
// for any Routine whose day + subject (+project) matches the session.
import { v4 as uuid } from 'uuid'
import { db } from '../db/app-db'
import type { Session, RoutineLog, StreakDay, DayOfWeek } from '../domain/types'
import { getSessionScope, isoNow, sessionLocalDate } from './utils'
import { loadSettings } from './settings-store'

/**
 * For the given session, find all matching routines (today's day + same subject
 * + same project-or-any) and update today's RoutineLog for each by adding the
 * session's minutes. Creates the log if it doesn't exist yet.
 */
export async function updateRoutineLogsForSession(session: Session): Promise<void> {
  const subjects = await db.subjects.toArray()
  const categories = await db.categories.toArray()
  if (getSessionScope(session, subjects, categories) !== 'academic') return
  const sessionDate = sessionLocalDate(session.startAt) // YYYY-MM-DD
  const sessionDow = new Date(session.startAt).getDay() as DayOfWeek

  const allRoutines = await db.routines.toArray()
  const matching = allRoutines.filter((r) => {
    if (r.deletedAt) return false
    if (!r.dayMinutes[sessionDow] || r.dayMinutes[sessionDow]! <= 0) return false
    if (r.subjectId !== session.subjectId) return false
    if (r.projectId && r.projectId !== session.projectId) return false
    return true
  })
    // Tag the session with the first matching routine (only if not already tagged)
    if (matching.length > 0 && !session.routineId) {
      await db.sessions.update(session.id, { routineId: matching[0].id, updatedAt: isoNow() })
    }

  if (matching.length === 0) return

  // Find existing log per matching routine
  const logs = await db.routineLogs.toArray()
  for (const routine of matching) {
    const existing = logs.find((l) => l.routineId === routine.id && l.date === sessionDate)
    const addedMinutes = existing
      ? existing.actualMinutes + session.durationMinutes
      : session.durationMinutes
    const completed = addedMinutes >= (routine.dayMinutes[sessionDow] ?? 0)

    if (existing) {
      await db.routineLogs.update(existing.id, {
        actualMinutes: addedMinutes,
        completed,
      })
    } else {
      const newLog: RoutineLog = {
        id: uuid(),
        routineId: routine.id,
        date: sessionDate,
        actualMinutes: addedMinutes,
        completed,
        createdAt: isoNow(),
      }
      await db.routineLogs.add(newLog)
    }
  }
}
/** Subtract a session's minutes from any matching routine logs. Used on delete. */
export async function revertRoutineLogsForSession(session: Session): Promise<void> {
  const subjects = await db.subjects.toArray()
  const categories = await db.categories.toArray()
  if (getSessionScope(session, subjects, categories) !== 'academic') return
  const sessionDate = sessionLocalDate(session.startAt)
  const sessionDow = new Date(session.startAt).getDay() as DayOfWeek

  const allRoutines = await db.routines.toArray()
  const matching = allRoutines.filter((r) => {
    if (r.deletedAt) return false
    if (!r.dayMinutes[sessionDow] || r.dayMinutes[sessionDow]! <= 0) return false
    if (r.subjectId !== session.subjectId) return false
    if (r.projectId && r.projectId !== session.projectId) return false
    return true
  })

  if (matching.length === 0) return

  const logs = await db.routineLogs.toArray()
  for (const routine of matching) {
    const existing = logs.find((l) => l.routineId === routine.id && l.date === sessionDate)
    if (!existing) continue
    const remaining = Math.max(0, existing.actualMinutes - session.durationMinutes)
    await db.routineLogs.update(existing.id, {
      actualMinutes: remaining,
      completed: remaining >= (routine.dayMinutes[sessionDow] ?? 0),
    })
  }
}

/**
 * When a session is saved, recalculate the StreakDay for the session's date.
 * Sums all academic session minutes for that date and compares against the
 * user's dailyTargetMinutes setting. Upserts the StreakDay record.
 */
export async function updateStreakDayForSession(session: Session): Promise<void> {
  const subjects = await db.subjects.toArray()
  const categories = await db.categories.toArray()
  if (getSessionScope(session, subjects, categories) !== 'academic') return

  const dateKey = sessionLocalDate(session.startAt) // YYYY-MM-DD
  const settings = loadSettings()
  const target = settings.dailyTargetMinutes

  // Use the startAt index to bound the query to just this calendar day, instead
  // of pulling the entire sessions table. Avoids O(n) scans on large datasets.
  const dayStart = new Date(`${dateKey}T00:00:00`).toISOString()
  const dayEnd = new Date(`${dateKey}T23:59:59.999`).toISOString()
  const todaysSessions = await db.sessions
    .where('startAt')
    .between(dayStart, dayEnd, true, true)
    .toArray()

  let totalMinutes = 0
  for (const s of todaysSessions) {
    if (s.deletedAt) continue
    if (getSessionScope(s, subjects, categories) !== 'academic') continue
    totalMinutes += s.durationMinutes
  }

  const goalMet = totalMinutes >= target
  const existing = await db.streakDays.get(dateKey)

  if (existing) {
    await db.streakDays.update(dateKey, { totalMinutes, goalMet })
  } else {
    const streakDay: StreakDay = {
      id: dateKey,
      totalMinutes,
      goalMet,
      createdAt: isoNow(),
    }
    await db.streakDays.add(streakDay)
  }
}

/**
 * When a session is deleted, recalculate the StreakDay for the session's date.
 * If no academic sessions remain for that date, remove the StreakDay record.
 */
export async function revertStreakDayForSession(session: Session): Promise<void> {
  const subjects = await db.subjects.toArray()
  const categories = await db.categories.toArray()
  if (getSessionScope(session, subjects, categories) !== 'academic') return

  const dateKey = sessionLocalDate(session.startAt)
  const settings = loadSettings()
  const target = settings.dailyTargetMinutes

  const dayStart = new Date(`${dateKey}T00:00:00`).toISOString()
  const dayEnd = new Date(`${dateKey}T23:59:59.999`).toISOString()
  const todaysSessions = await db.sessions
    .where('startAt')
    .between(dayStart, dayEnd, true, true)
    .toArray()

  let totalMinutes = 0
  for (const s of todaysSessions) {
    if (s.deletedAt) continue
    if (s.id === session.id) continue // exclude the deleted session
    if (getSessionScope(s, subjects, categories) !== 'academic') continue
    totalMinutes += s.durationMinutes
  }

  const existing = await db.streakDays.get(dateKey)
  if (totalMinutes === 0 && existing) {
    await db.streakDays.delete(dateKey)
  } else if (existing) {
    const goalMet = totalMinutes >= target
    await db.streakDays.update(dateKey, { totalMinutes, goalMet })
  }
}
