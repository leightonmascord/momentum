// SubjectBreakdown — shows today's study time grouped by subject.
// Used in the Dashboard "Today" widget.

import { useMemo } from 'react'
import type { Session, Subject, Category } from '../../domain/types'
import { sessionLocalDate, getTopLevelSubject, getSessionScope } from '../../lib/utils'

interface SubjectBreakdownProps {
  sessions: Session[]
  subjects: Subject[]
  categories: Category[]
  todayStr: string
  liveTimerSeconds?: number
  liveTimerSubjectId?: string | null
}

export function SubjectBreakdown({
  sessions,
  subjects,
  categories,
  todayStr,
  liveTimerSeconds = 0,
  liveTimerSubjectId = null,
}: SubjectBreakdownProps) {
  const subjectMap = useMemo(
    () => new Map(subjects.filter((s) => !s.deletedAt).map((s) => [s.id, s])),
    [subjects]
  )

  const breakdown = useMemo(() => {
    const minutesBySubject = new Map<string, number>()
    for (const s of sessions) {
      if (s.deletedAt) continue
      if (sessionLocalDate(s.startAt) !== todayStr) continue
      const topLevel = getTopLevelSubject(s.subjectId, subjects)
      if (!topLevel) continue
      minutesBySubject.set(topLevel.id, (minutesBySubject.get(topLevel.id) ?? 0) + s.durationMinutes)
    }
    // Only add live timer minutes if the live timer subject is academic.
    if (liveTimerSeconds > 0 && liveTimerSubjectId) {
      const scope = getSessionScope(
        { subjectId: liveTimerSubjectId } as Session,
        subjects,
        categories,
      )
      if (scope === 'academic') {
        const liveMinutes = liveTimerSeconds / 60
        const topLevel = getTopLevelSubject(liveTimerSubjectId, subjects)
        if (topLevel) {
          minutesBySubject.set(topLevel.id, (minutesBySubject.get(topLevel.id) ?? 0) + liveMinutes)
        }
      }
    }
    const total = Array.from(minutesBySubject.values()).reduce((a, b) => a + b, 0)
    if (total === 0) return []
    return Array.from(minutesBySubject.entries())
      .map(([id, minutes]) => ({
        id,
        name: subjectMap.get(id)?.name ?? 'Unknown',
        color: subjectMap.get(id)?.color ?? '#94a3b8',
        minutes,
        pct: Math.round((minutes / total) * 100),
      }))
      .sort((a, b) => b.minutes - a.minutes)
  }, [sessions, subjects, categories, todayStr, liveTimerSeconds, liveTimerSubjectId, subjectMap])

  if (breakdown.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">No study time logged today</p>
  }

  return (
    <div className="space-y-1.5">
      {breakdown.map((row) => (
        <div key={row.id} className="flex items-center gap-2 text-sm">
          <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
          <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{row.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-slate-600 dark:text-slate-400">{Math.round(row.minutes)}m</span>
          <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div className="h-full rounded-full bg-primary-500" style={{ width: `${row.pct}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500">{row.pct}%</span>
        </div>
      ))}
    </div>
  )
}
