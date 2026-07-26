import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { format, subDays } from 'date-fns'
import { useData } from '../../app/providers'
import { Card, CardHeader, CardTitle } from '../../components/ui/Card'
import { PageSpinner } from '../../components/ui/Spinner'
import { cn, formatHours, formatMinutes, getSessionScope, pctToGrade, gradeColor, sessionLocalDate, toLocalDateString } from '../../lib/utils'
import type { Session, DayOfWeek } from '../../domain/types'
import { Link } from 'react-router-dom'
import { loadSettings } from '../../lib/settings-store'

type ScopeOption = 'academic' | 'nonAcademic' | 'all'
type Period = 'week' | 'month' | 'threeMonths' | 'all'

const SCOPE_OPTIONS: { value: ScopeOption; label: string }[] = [
  { value: 'academic', label: 'Academic' },
  { value: 'nonAcademic', label: 'Non-academic' },
  { value: 'all', label: 'All' },
]

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'threeMonths', label: 'Last 3 Months' },
  { value: 'all', label: 'All Time' },
]

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function periodDays(period: Period): number {
  if (period === 'week') return 7
  if (period === 'month') return 30
  if (period === 'threeMonths') return 90
  return 0 // 'all'
}

function filterSessionsByPeriod(sessions: Session[], period: Period): Session[] {
  const days = periodDays(period)
  if (days === 0) return sessions
  const cutoff = subDays(new Date(), days)
  return sessions.filter((s) => new Date(s.startAt) >= cutoff)
}

/** Build a Map of date-string → total minutes for a given set of sessions. */
function minutesByDate(sessions: Session[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of sessions) {
    const key = toLocalDateString(s.startAt)
    m.set(key, (m.get(key) ?? 0) + s.durationMinutes)
  }
  return m
}

export default function ReportsPage() {
  const { data, isLoading } = useData()
  const [scope, setScope] = useState<ScopeOption>('academic')
  const [period, setPeriod] = useState<Period>('week')

  useEffect(() => {
    function onPeriod(e: Event) {
      const val = (e as CustomEvent).detail as string
      if (val === 'week' || val === 'month' || val === 'threeMonths' || val === 'all') {
        setPeriod(val)
      }
    }
    window.addEventListener('momentum:reports-period', onPeriod)
    return () => window.removeEventListener('momentum:reports-period', onPeriod)
  }, [])

  useEffect(() => {
    function onScope(e: Event) {
      const val = (e as CustomEvent).detail as string
      if (val === 'all' || val === 'academic' || val === 'nonAcademic') {
        setScope(val)
      }
    }
    window.addEventListener('momentum:reports-scope', onScope)
    return () => window.removeEventListener('momentum:reports-scope', onScope)
  }, [])

  // Scope filter first
  const scopeFiltered = useMemo(() => {
    const active = data.sessions.filter((s) => !s.deletedAt)
    if (scope === 'all') return active
    return active.filter((s) => getSessionScope(s, data.subjects, data.categories) === scope)
  }, [data.sessions, data.subjects, data.categories, scope])

  // Period filter second
  const sessions = useMemo(() => filterSessionsByPeriod(scopeFiltered, period), [scopeFiltered, period])
  // Previous period for comparison
  const prevSessions = useMemo(() => {
    if (period === 'all') return [] as Session[]
    const days = periodDays(period)
    const now = new Date()
    const periodStart = subDays(now, days)
    const prevEnd = subDays(periodStart, 1)
    const prevStart = subDays(prevEnd, days - 1)
    return scopeFiltered.filter((s) => {
      const d = new Date(s.startAt)
      return d >= prevStart && d <= prevEnd
    })
  }, [scopeFiltered, period])

  const subjectsById = useMemo(() => new Map(data.subjects.map((s) => [s.id, s])), [data.subjects])

  // ── Overview metrics ──
  const overview = useMemo(() => {
    const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0)
    const sessionCount = sessions.length
    const longestSession = sessions.reduce((max, s) => Math.max(max, s.durationMinutes), 0)
    const avgSessionLength = sessionCount > 0 ? totalMinutes / sessionCount : 0
    const daySet = new Set(sessions.map((s) => toLocalDateString(s.startAt)))
    const avgPerDay = daySet.size > 0 ? totalMinutes / daySet.size : 0

    // Previous period
    const prevTotal = prevSessions.reduce((sum, s) => sum + s.durationMinutes, 0)
    const prevCount = prevSessions.length
    const prevAvgLen = prevCount > 0 ? prevTotal / prevCount : 0
    const prevDaySet = new Set(prevSessions.map((s) => toLocalDateString(s.startAt)))
    const prevAvgPerDay = prevDaySet.size > 0 ? prevTotal / prevDaySet.size : 0
    return { totalMinutes, sessionCount, avgSessionLength, avgPerDay, longestSession, prevTotal, prevCount, prevAvgLen, prevAvgPerDay }
  }, [sessions, prevSessions])

  const { totalMinutes, sessionCount, avgSessionLength, avgPerDay, longestSession, prevTotal, prevAvgLen, prevAvgPerDay } = overview

  const pctChange = prevTotal > 0 ? Math.round(((totalMinutes - prevTotal) / prevTotal) * 100) : null
  const avgLenChange = prevAvgLen > 0 ? Math.round(((avgSessionLength - prevAvgLen) / prevAvgLen) * 100) : null
  const avgDayChange = prevAvgPerDay > 0 ? Math.round(((avgPerDay - prevAvgPerDay) / prevAvgPerDay) * 100) : null

  // ── Time by Focus Area ──
  const bySubject = useMemo(() => {
    const acc = new Map<string, number>()
    for (const s of sessions) {
      const sub = subjectsById.get(s.subjectId)
      const name = sub?.name ?? 'Unknown'
      acc.set(name, (acc.get(name) ?? 0) + s.durationMinutes)
    }
    return [...acc.entries()].sort((a, b) => b[1] - a[1])
  }, [sessions, subjectsById])


  // ── Schedule adherence (planned vs actual) ──
  const scheduleAdherence = useMemo(() => {
    const days = periodDays(period)
    const count = days === 0 ? 30 : days
    const rows: { date: string; dayLabel: string; planned: number; actual: number }[] = []
    for (let i = count - 1; i >= 0; i--) {
      const d = subDays(new Date(), i)
      const date = format(d, 'yyyy-MM-dd')
      const dow = d.getDay()
      const planned = data.routines
        .filter((r) => !r.deletedAt && (r.dayMinutes[dow as DayOfWeek] ?? 0) > 0)
        .reduce((sum, r) => sum + (r.dayMinutes[dow as DayOfWeek] ?? 0), 0)
      const actual = sessions
        .filter((s) => sessionLocalDate(s.startAt) === date)
        .reduce((sum, s) => sum + s.durationMinutes, 0)
      rows.push({ date, dayLabel: DAY_NAMES_SHORT[dow], planned, actual })
    }
    return rows
  }, [data.routines, sessions, period])
  const subjectColors = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sessions) {
      const sub = subjectsById.get(s.subjectId)
      if (sub) m.set(sub.name, sub.color)
    }
    return m
  }, [sessions, subjectsById])

  // ── Daily Trend (last 30 days heatmap) ──
  const dailyTrend = useMemo(() => {
    const byDate = minutesByDate(sessions)
    const days = periodDays(period) || 90
    const items: { date: Date; ds: string; minutes: number }[] = []
    for (let i = 0; i < days; i++) {
      const d = subDays(new Date(), days - 1 - i)
      const ds = format(d, 'yyyy-MM-dd')
      items.push({ date: d, ds, minutes: byDate.get(ds) ?? 0 })
    }
    const maxMinutes = Math.max(1, ...items.map((x) => x.minutes))
    return { items, maxMinutes }
  }, [sessions, period])

  // ── Grades by Subject ──
  const gradesBySubject = useMemo(() => {
    if (scope === 'nonAcademic') return [] as { subjectName: string; weightPct: number; letter: string; colorClass: string }[]
    // Get subject IDs in scope
    const subjectIdsInScope = new Set<string>()
    for (const s of data.subjects) {
      const cat = data.categories.find((c) => c.id === s.categoryId)
      if (scope === 'all' || cat?.scope === scope) {
        subjectIdsInScope.add(s.id)
      }
    }

    const marksInScope = data.marks.filter((m) => subjectIdsInScope.has(m.subjectId))
    if (marksInScope.length === 0) return []

    // Group by subject, compute weighted average
    const acc = new Map<string, { totalWeight: number; weightedScore: number }>()
    for (const m of marksInScope) {
      const sub = data.subjects.find((s) => s.id === m.subjectId)
      if (!sub) continue
      const name = sub.name
      const pct = m.total > 0 ? (m.score / m.total) * 100 : 0
      const entry = acc.get(name) ?? { totalWeight: 0, weightedScore: 0 }
      entry.totalWeight += m.weight
      entry.weightedScore += pct * m.weight
      acc.set(name, entry)
    }

    return [...acc.entries()]
      .map(([subjectName, { totalWeight, weightedScore }]) => {
        const weightPct = totalWeight > 0 ? weightedScore / totalWeight : 0
        const letter = pctToGrade(Math.round(weightPct))
        return { subjectName, weightPct, letter, colorClass: gradeColor(letter) }
      })
      .sort((a, b) => b.weightPct - a.weightPct)
  }, [data.marks, data.subjects, data.categories, scope])

  // ── Study Distribution by Day of Week ──
  const dayDistribution = useMemo(() => {
    const acc = new Array(7).fill(0)
    for (const s of sessions) {
      const day = new Date(s.startAt).getDay()
      acc[day] += s.durationMinutes
    }
    const maxMinutes = Math.max(1, ...acc)
    return acc.map((minutes, i) => ({ dayIndex: i, label: DAY_LABELS[i], shortLabel: DAY_NAMES_SHORT[i], minutes, pct: maxMinutes > 0 ? minutes / maxMinutes : 0 }))
  }, [sessions])
  // ── Insights ──
  const insights = useMemo(() => {
    if (sessions.length === 0) return [] as ReactNode[]
    const out: ReactNode[] = []

    // Most studied subject
    if (bySubject.length > 0) {
      const [topName, topMinutes] = bySubject[0]
      out.push(<>Most studied subject: <Link to="/subjects" className="underline hover:text-primary-600">{topName}</Link> with {formatHours(topMinutes)}h</>)
    }

    // Best day of week
    const bestDay = dayDistribution.reduce((best, cur) => (cur.minutes > best.minutes ? cur : best), dayDistribution[0])
    if (bestDay && bestDay.minutes > 0) {
      out.push(<>Best day of week: {bestDay.label} ({formatMinutes(bestDay.minutes)})</>)
    }

    // Average session length
    out.push(<>Average session length: {formatMinutes(Math.round(avgSessionLength))}</>)

    // Longest session
    out.push(<>Longest session: {formatHours(longestSession)}h</>)

    // Comparison vs last period
    if (pctChange !== null && period !== 'all') {
      const arrow = pctChange >= 0 ? '↑' : '↓'
      const periodLabel = period === 'week' ? 'week' : period === 'month' ? 'month' : '3 months'
      out.push(<>{arrow} {Math.abs(pctChange)}% vs last {periodLabel} ({formatHours(prevTotal)}h → {formatHours(totalMinutes)}h)</>)
    }

    // Session count insight
    if (sessionCount > 0) {
      out.push(<>{sessionCount} session{sessionCount !== 1 ? 's' : ''} over {dailyTrend.items.length} day{dailyTrend.items.length !== 1 ? 's' : ''}</>)
    }

    return out
  }, [sessions, bySubject, dayDistribution, avgSessionLength, longestSession, pctChange, period, prevTotal, totalMinutes, sessionCount, dailyTrend.items.length])

  if (isLoading) return <PageSpinner />

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const settings = loadSettings()

  return (
    <div className="space-y-6">
      {/* Scope toggle */}
      <div className="inline-flex rounded-full bg-slate-200 p-1 dark:bg-slate-700" role="tablist" aria-label="Scope filter">
        {SCOPE_OPTIONS.map((opt) => {
          const active = scope === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setScope(opt.value)}
              className={
                active
                  ? opt.value === 'all'
                    ? 'rounded-full bg-slate-300 px-4 py-1.5 text-sm font-medium text-slate-900 shadow-sm transition-colors dark:bg-slate-300 dark:text-slate-900'
                    : 'rounded-full bg-primary-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors'
                  : 'rounded-full bg-white px-4 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-900 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
              }
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* 1. Period selector */}
      <div className="inline-flex rounded-full bg-slate-200 p-1 dark:bg-slate-700" role="tablist" aria-label="Period filter">
        {PERIOD_OPTIONS.map((opt) => {
          const active = period === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setPeriod(opt.value)}
              className={
                active
                  ? 'rounded-full bg-primary-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors'
                  : 'rounded-full bg-white px-4 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-900 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
              }
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* 2. Enhanced Overview card */}
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <div className="text-sm text-slate-500">Total Time</div>
            <div className="text-2xl font-semibold text-slate-800 dark:text-slate-100">
              {formatHours(totalMinutes)}
            </div>
            {pctChange !== null && period !== 'all' && (
              <div className={cn('text-xs font-medium', pctChange >= 0 ? 'text-green-600' : 'text-red-600')}>
                {pctChange >= 0 ? '↑' : '↓'} {Math.abs(pctChange)}%
              </div>
            )}
          </div>
          <div>
            <div className="text-sm text-slate-500">Sessions</div>
            <div className="text-2xl font-semibold text-slate-800 dark:text-slate-100">{sessionCount}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500">Avg Session</div>
            <div className="text-2xl font-semibold text-slate-800 dark:text-slate-100">{formatMinutes(Math.round(avgSessionLength))}</div>
            {avgLenChange !== null && period !== 'all' && (
              <div className={cn('text-xs font-medium', avgLenChange >= 0 ? 'text-green-600' : 'text-red-600')}>
                {avgLenChange >= 0 ? '↑' : '↓'} {Math.abs(avgLenChange)}%

              </div>
            )}
          </div>
          <div>
            <div className="text-sm text-slate-500">Avg / Day</div>
            <div className="text-2xl font-semibold text-slate-800 dark:text-slate-100">{formatMinutes(Math.round(avgPerDay))}</div>
            {avgDayChange !== null && period !== 'all' && (
              <div className={cn('text-xs font-medium', avgDayChange >= 0 ? 'text-green-600' : 'text-red-600')}>
                {avgDayChange >= 0 ? '↑' : '↓'} {Math.abs(avgDayChange)}%
              </div>
            )}
          </div>
          <div>
            <div className="text-sm text-slate-500">Longest Session</div>
            <div className="text-2xl font-semibold text-slate-800 dark:text-slate-100">{formatHours(longestSession)}</div>
          </div>
        </div>
      </Card>

      {/* Schedule adherence chart */}
      {scheduleAdherence.length > 0 && scheduleAdherence.some((r) => r.planned > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Schedule Adherence</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            {scheduleAdherence.filter((r) => r.planned > 0 || r.actual > 0).slice(-14).map((r) => {
              const maxVal = Math.max(r.planned, r.actual, 1)
              return (
                <div key={r.date} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-xs text-slate-500">{r.dayLabel} {format(new Date(r.date), 'd')}</span>
                  <div className="flex-1 flex gap-1 h-4">
                    <div className="flex items-center gap-1">
                      <div className="h-3 rounded bg-slate-300 dark:bg-slate-600" style={{ width: `${Math.round((r.planned / maxVal) * 80)}px` }} />
                      <span className="text-[10px] text-slate-400">{r.planned}m</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="h-3 rounded bg-primary-500" style={{ width: `${Math.round((r.actual / maxVal) * 80)}px` }} />
                      <span className="text-[10px] text-slate-600 dark:text-slate-300">{r.actual}m</span>
                    </div>
                  </div>
                </div>
              )
            })}
            <div className="flex gap-4 text-xs text-slate-500 mt-2">
              <div className="flex items-center gap-1"><div className="h-2.5 w-2.5 rounded bg-slate-300 dark:bg-slate-600" /> Planned</div>
              <div className="flex items-center gap-1"><div className="h-2.5 w-2.5 rounded bg-primary-500" /> Actual</div>
            </div>
          </div>
        </Card>
      )}
      {/* 3. Time by Focus Area with bar chart */}
      <Card>
        <CardHeader>
          <CardTitle>Time by Focus Area</CardTitle>
        </CardHeader>
        {bySubject.length === 0 ? (
          <p className="text-sm text-slate-500">No data yet.</p>
        ) : (
          <div className="space-y-4">
            {/* Horizontal bar chart */}
            <div className="space-y-2">
              {bySubject.map(([name, minutes]) => {
                const pct = totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0
                const color = subjectColors.get(name) ?? '#6366f1'
                return (
                  <div key={name}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-slate-700 dark:text-slate-300">{name}</span>
                      <span className="font-medium text-slate-800 dark:text-slate-100">{formatMinutes(minutes)} ({pct}%)</span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className="h-3 rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Table */}
            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <th className="px-3 py-2">Subject</th>
                    <th className="px-3 py-2 text-right">Minutes</th>
                    <th className="px-3 py-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {bySubject.map(([name, minutes]) => {
                    const pct = totalMinutes > 0 ? ((minutes / totalMinutes) * 100).toFixed(1) : '0.0'
                    return (
                      <tr key={name} className="text-slate-700 dark:text-slate-300">
                        <td className="px-3 py-1.5">{name}</td>
                        <td className="px-3 py-1.5 text-right font-medium">{formatMinutes(minutes)}</td>
                        <td className="px-3 py-1.5 text-right">{pct}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* 4. Daily Trend bar chart */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Trend</CardTitle>
        </CardHeader>
        {(() => {
          const chartMax = Math.max(dailyTrend.maxMinutes, settings.dailyTargetMinutes, 1)
          const targetPct = settings.dailyTargetMinutes > 0
            ? (settings.dailyTargetMinutes / chartMax) * 100
            : 100
          return (
            <>
              <div className="overflow-x-auto">
                <div className="relative flex h-40 min-w-full items-end gap-1">
                  {/* Target line */}
                  <div
                    className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-amber-500"
                    style={{ bottom: `${targetPct}%` }}
                    aria-hidden
                  />
                  <div
                    className="pointer-events-none absolute right-1 -translate-y-1/2 rounded bg-amber-500 px-1 text-[10px] font-medium leading-4 text-white"
                    style={{ bottom: `calc(${targetPct}% + 2px)` }}
                    aria-hidden
                  >
                    Target {settings.dailyTargetMinutes}m
                  </div>
                  {dailyTrend.items.map(({ date, ds, minutes }) => {
                    const isToday = ds === todayStr
                    const heightPct = (minutes / chartMax) * 100
                    return (
                      <div
                        key={ds}
                        className="flex h-full w-3 shrink-0 flex-col items-center justify-end"
                        title={`${format(date, 'd MMM')}: ${formatMinutes(minutes)}`}
                      >
                        <div
                          className={cn(
                            'w-full rounded-t-sm transition-all',
                            isToday && 'ring-2 ring-primary-500',
                            minutes === 0 ? 'bg-slate-100 dark:bg-slate-800' : 'bg-primary-500',
                          )}
                          style={{ height: `${heightPct}%`, minHeight: minutes > 0 ? '2px' : 0 }}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-end gap-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary-500" />
                  Minutes
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-0 w-3 border-t border-dashed border-amber-500" />
                  Target
                </span>
              </div>
            </>
          )
        })()}
      </Card>

      {/* 5. Grades by Subject */}
      {gradesBySubject.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Grades by Subject</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            {gradesBySubject.map(({ subjectName, weightPct, letter, colorClass }) => (
              <div key={subjectName} className="flex items-center justify-between">
                <span className="text-slate-700 dark:text-slate-300">{subjectName}</span>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-24 rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-2 rounded-full bg-primary-500"
                      style={{ width: `${Math.min(100, Math.round(weightPct))}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                    {weightPct.toFixed(1)}%
                  </span>
                  <span className={cn('w-6 text-right text-lg font-bold', colorClass)}>{letter}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {/* 6. Habits Summary */}
      {data.habits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Habits Summary</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            {data.habits.filter(h => !h.archivedAt && (data.habitLogs.some(l => l.habitId === h.id) || (Date.now() - new Date(h.createdAt).getTime()) < 7 * 86400000)).map(habit => {
              const logs = data.habitLogs.filter(l => l.habitId === habit.id)
              const uniqueDays = new Set(logs.map(l => l.date)).size
              const recentLogs = logs.filter(l => {
                const d = new Date(l.date)
                const now = new Date()
                return (now.getTime() - d.getTime()) < 7 * 86400000
              }).length
              return (
                <div key={habit.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: habit.color }} />
                    <span className="text-slate-700 dark:text-slate-300">{habit.name}</span>
                    <span className="text-xs text-slate-400">({habit.kind})</span>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <span>{recentLogs} logs this week</span>
                    <span className="ml-2">{uniqueDays} total days</span>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* 7. Study Distribution by Day of Week */}
      <Card>
        <CardHeader>
          <CardTitle>Study Distribution</CardTitle>
        </CardHeader>
        {dayDistribution.every((d) => d.minutes === 0) ? (
          <p className="text-sm text-slate-500">No data yet.</p>
        ) : (
          <div className="space-y-2">
            {dayDistribution.map(({ label, shortLabel, minutes, pct }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="w-10 text-right text-xs text-slate-500">{shortLabel}</span>
                <div className="flex-1">
                  <div className="h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-2.5 rounded-full bg-primary-500 transition-all"
                      style={{ width: `${pct * 100}%` }}
                    />
                  </div>
                </div>
                <span className="w-14 text-right text-xs font-medium text-slate-700 dark:text-slate-300">
                  {formatMinutes(minutes)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>


      {/* 7. Insights */}
      <Card>
        <CardHeader>
          <CardTitle>Insights</CardTitle>
        </CardHeader>
        {insights.length === 0 ? (
          <p className="text-sm text-slate-500">Log a session to see insights.</p>
        ) : (
          <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
            {insights.map((line, i) => (

              <li key={i}>• {line}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
