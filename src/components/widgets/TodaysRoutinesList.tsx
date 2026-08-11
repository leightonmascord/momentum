// Today's routines compact list — shows scheduled routines for today with their status.
// Used in Dashboard (max 5 rows) and RoutinePage (max 6 rows).
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Routine, RoutineLog, Subject, DayOfWeek } from '../../domain/types'
import { cn } from '../../lib/utils'
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu'

interface TodaysRoutinesListProps {
  routines: Routine[]
  routineLogs: RoutineLog[]
  subjects: Subject[]
  todayStr: string
  todayDow: DayOfWeek
  maxItems?: number
  /** If true, each row is clickable and links to /routines */
  clickable?: boolean
  /** Optional callback when a row is clicked (used for expand) */
  onRowClick?: (routine: Routine) => void
  /** Optional context-menu actions per routine row (right-click / long-press) */
  onContextActions?: (routine: Routine) => ContextMenuItem[]
}

export function TodaysRoutinesList({
  routines,
  routineLogs,
  subjects,
  todayStr,
  todayDow,
  maxItems = 5,
  clickable = false,
  onRowClick,
  onContextActions,
}: TodaysRoutinesListProps) {
  const subjectsMap = useMemo(
    () => new Map(subjects.filter(s => !s.deletedAt).map(s => [s.id, s])),
    [subjects]
  )

  // Filter to today's routines and sort by today's target minutes descending
  const todaysRoutines = useMemo(
    () => routines.filter(r => !r.deletedAt && (r.dayMinutes[todayDow] ?? 0) > 0),
    [routines, todayDow]
  ).sort((a, b) => (b.dayMinutes[todayDow] ?? 0) - (a.dayMinutes[todayDow] ?? 0))

  // Build log map for today
  const logMap = useMemo(
    () => {
      const map = new Map<string, RoutineLog>()
      routineLogs
        .filter(l => l.date === todayStr)
        .forEach(l => map.set(l.routineId, l))
      return map
    },
    [routineLogs, todayStr]
  )

  const displayRoutines = todaysRoutines.slice(0, maxItems)
  const hasMore = todaysRoutines.length > maxItems

  if (displayRoutines.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No routines scheduled for today
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {displayRoutines.map(routine => {
        const log = logMap.get(routine.id)
        const subject = subjectsMap.get(routine.subjectId)
        const target = routine.dayMinutes[todayDow] ?? 0
        const actual = log?.actualMinutes ?? 0
        const completed = log?.completed ?? false

        // Status: checked if completed, partial if some progress, empty if not started
        let status: { label: string; className: string }
        if (completed || actual >= target) {
          status = { label: '✓', className: 'text-green-600 dark:text-green-400' }
        } else if (actual > 0) {
          status = { label: `${actual}/${target}m`, className: 'text-amber-600 dark:text-amber-400' }
        } else {
          status = { label: `${target}m`, className: 'text-slate-400 dark:text-slate-500' }
        }

        const Row = (
          <div
            key={routine.id}
            className={cn(
              'flex items-center gap-2 py-1',
              clickable && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 rounded'
            )}
            onClick={() => clickable && onRowClick?.(routine)}
          >
            {/* Color dot */}
            <div
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: routine.color || subject?.color || '#6366f1' }}
            />
            {/* Routine name */}
            <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-300">
              {routine.name}
            </span>
            {/* Subject name (small, muted) */}
            {subject && (
              <span className="hidden xs:inline text-xs text-slate-400 dark:text-slate-500 truncate max-w-[80px]">
                {subject.name}
              </span>
            )}
            {/* Status */}
            <span className={cn('text-xs font-medium', status.className)}>
              {status.label}
            </span>
          </div>
        )

        const content = clickable ? (
          <Link key={routine.id} to="/routines" className="block">
            {Row}
          </Link>
        ) : (
          Row
        )

        const actions = onContextActions?.(routine)
        if (actions && actions.length > 0) {
          return <ContextMenu key={routine.id} items={actions}>{content}</ContextMenu>
        }
        return content
      })}
      {hasMore && (
        <Link
          to="/routines"
          className="block text-xs text-primary-600 hover:underline dark:text-primary-400"
        >
          Show all ({todaysRoutines.length}) →
        </Link>
      )}
    </div>
  )
}