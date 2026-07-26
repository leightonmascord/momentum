import { useMemo, useState } from 'react'
import { format, subDays, startOfWeek, endOfWeek, parseISO, eachDayOfInterval, isWithinInterval, isSameDay } from 'date-fns'
import { useData } from '../../app/providers'
import { Card, CardHeader, CardTitle } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { cn, formatMinutes } from '../../lib/utils'
import { loadSettings } from '../../lib/settings-store'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_ABBREVS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type DatePreset = 'thisWeek' | 'lastWeek' | 'last2Weeks'

function getDatePresetRange(preset: DatePreset): { start: Date; end: Date } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (preset) {
    case 'thisWeek': {
      const start = startOfWeek(today, { weekStartsOn: 1 }) // Monday
      const end = endOfWeek(today, { weekStartsOn: 1 })
      return { start, end }
    }
    case 'lastWeek': {
      const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 })
      const start = subDays(thisWeekStart, 7)
      const end = subDays(thisWeekStart, 1)
      return { start, end }
    }
    case 'last2Weeks': {
      const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 })
      const start = subDays(thisWeekStart, 14)
      const end = subDays(thisWeekStart, 1)
      return { start, end }
    }
  }
}

export default function AIReviewPage() {
  const { data, isLoading } = useData()
  const settings = loadSettings()
  const [datePreset, setDatePreset] = useState<DatePreset>('thisWeek')
  const [customStart, setCustomStart] = useState<string>('')
  const [customEnd, setCustomEnd] = useState<string>('')
  const [showCustom, setShowCustom] = useState(false)
  const [copied, setCopied] = useState(false)

  // Calculate date range
  const dateRange = useMemo(() => {
    if (showCustom && customStart && customEnd) {
      return { start: parseISO(customStart), end: parseISO(customEnd) }
    }
    return getDatePresetRange(datePreset)
  }, [datePreset, customStart, customEnd, showCustom])

  // Filter sessions for the date range
  const weekSessions = useMemo(() => {
    return data.sessions.filter((s) => {
      const sessionDate = parseISO(s.startAt)
      return isWithinInterval(sessionDate, { start: dateRange.start, end: dateRange.end })
    })
  }, [data.sessions, dateRange])

  // Calculate stats
  const stats = useMemo(() => {
    const totalMinutes = weekSessions.reduce((sum, s) => sum + s.durationMinutes, 0)
    const totalSessions = weekSessions.length
    const avgSessionLength = totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0

    // Daily breakdown
    const days = eachDayOfInterval({ start: dateRange.start, end: dateRange.end })
    const dailyMinutes = days.map((day) => {
      const daySessions = weekSessions.filter((s) => isSameDay(parseISO(s.startAt), day))
      return daySessions.reduce((sum, s) => sum + s.durationMinutes, 0)
    })

    // Most productive day
    const maxDailyMinutes = Math.max(...dailyMinutes, 0)
    const mostProductiveDayIdx = dailyMinutes.indexOf(maxDailyMinutes)
    const mostProductiveDay = maxDailyMinutes > 0 ? DAY_NAMES[days[mostProductiveDayIdx]?.getDay() ?? 0] : null

    // Time per subject
    const subjectTime: Record<string, { minutes: number; sessions: number }> = {}
    weekSessions.forEach((s) => {
      const subject = data.subjects.find((sub) => sub.id === s.subjectId)
      const name = subject?.name ?? 'Unknown'
      if (!subjectTime[name]) {
        subjectTime[name] = { minutes: 0, sessions: 0 }
      }
      subjectTime[name].minutes += s.durationMinutes
      subjectTime[name].sessions += 1
    })

    // Session types
    const pomodoroSessions = weekSessions.filter((s) => s.source === 'pomodoro')
    const timerSessions = weekSessions.filter((s) => s.source === 'timer')
    const manualSessions = weekSessions.filter((s) => s.source === 'manual' || s.source === 'quickLog')

    const pomodoroMinutes = pomodoroSessions.reduce((sum, s) => sum + s.durationMinutes, 0)
    const timerMinutes = timerSessions.reduce((sum, s) => sum + s.durationMinutes, 0)
    const manualMinutes = manualSessions.reduce((sum, s) => sum + s.durationMinutes, 0)

    // Longest session
    const longestSession = weekSessions.reduce(
      (max, s) => (s.durationMinutes > max ? s.durationMinutes : max),
      0
    )

    // Days target met
    const daysTargetMet = dailyMinutes.filter((m) => m >= settings.dailyTargetMinutes).length


    // Total streak (consecutive days up to end of range)
    let currentStreak = 0
    let checkDate = dateRange.end
    const sortedStreakDays = [...data.streakDays].sort((a, b) => b.id.localeCompare(a.id))

    for (const streakDay of sortedStreakDays) {
      const streakDate = parseISO(streakDay.id)
      if (streakDate > checkDate) continue
      if (streakDate < dateRange.start) break

      // Check if this day is consecutive to the previous check date
      const diffDays = Math.floor((checkDate.getTime() - streakDate.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays > 1) break

      if (streakDay.goalMet) {
        currentStreak++
        checkDate = subDays(streakDate, 1)
      } else {
        break
      }
    }

    return {
      totalMinutes,
      totalSessions,
      avgSessionLength,
      dailyMinutes,
      mostProductiveDay,
      mostProductiveDayMinutes: maxDailyMinutes,
      subjectTime,
      pomodoroSessions: pomodoroSessions.length,
      pomodoroMinutes,
      timerSessions: timerSessions.length,
      timerMinutes,
      manualSessions: manualSessions.length,
      manualMinutes,
      longestSession,
      daysTargetMet,
      daysInRange: days.length,
      currentStreak,
    }
  }, [weekSessions, data.subjects, data.streakDays, dateRange, settings.dailyTargetMinutes])

  // Generate the AI prompt
  const aiPrompt = useMemo(() => {
    const startStr = format(dateRange.start, 'MMM d, yyyy')
    const endStr = format(dateRange.end, 'MMM d, yyyy')
    const dateRangeStr = `${startStr} - ${endStr}`

    const lines: string[] = []

    lines.push(`I'm a student using a study tracker app called Momentum. Here are my study statistics for the week of ${dateRangeStr}. Please give me a detailed review of my study habits, strengths, weaknesses, and suggestions for improvement.`)
    lines.push('')
    lines.push('## Weekly Overview')
    lines.push(`- Total study time: ${formatMinutes(stats.totalMinutes)}`)
    lines.push(`- Total sessions: ${stats.totalSessions}`)
    lines.push(`- Average session length: ${stats.avgSessionLength} minutes`)
    lines.push(`- Longest session: ${stats.longestSession} minutes`)
    if (stats.mostProductiveDay) {
      lines.push(`- Most productive day: ${stats.mostProductiveDay} (${stats.mostProductiveDayMinutes}m)`)
    } else {
      lines.push(`- Most productive day: N/A`)
    }
    lines.push('')
    lines.push('## Daily Breakdown')

    const days = eachDayOfInterval({ start: dateRange.start, end: dateRange.end })
    days.forEach((day, idx) => {
      const dayName = DAY_ABBREVS[day.getDay()]
      const minutes = stats.dailyMinutes[idx] ?? 0
      lines.push(`- ${dayName}: ${minutes}m`)
    })
    lines.push('')
    lines.push('## Focus Area Breakdown')

    const sortedSubjects = Object.entries(stats.subjectTime).sort((a, b) => b[1].minutes - a[1].minutes)
    if (sortedSubjects.length === 0) {
      lines.push('- No focus area data available')
    } else {
      sortedSubjects.forEach(([name, data]) => {
        lines.push(`- ${name}: ${formatMinutes(data.minutes)} (${data.sessions} sessions)`)
      })
    }
    lines.push('')
    lines.push('## Session Types')
    lines.push(`- Pomodoro sessions: ${stats.pomodoroSessions} (${formatMinutes(stats.pomodoroMinutes)} total)`)
    lines.push(`- Simple timer sessions: ${stats.timerSessions} (${formatMinutes(stats.timerMinutes)} total)`)
    lines.push(`- Manual logs: ${stats.manualSessions} (${formatMinutes(stats.manualMinutes)} total)`)
    lines.push('')
    lines.push('## Goals')
    lines.push(`- Daily target: ${settings.dailyTargetMinutes} minutes`)
    lines.push(`- Days target met: ${stats.daysTargetMet}/${stats.daysInRange}`)
    lines.push('')
    lines.push('## Streak')
    lines.push(`- Current streak: ${stats.currentStreak} days`)
    lines.push('')

    // Active Habits
    const activeHabits = data.habits.filter(h => !h.archivedAt && h.status !== 'potential')
    if (activeHabits.length > 0) {
      lines.push('## Active Habits')
      activeHabits.forEach(habit => {
        const logs = data.habitLogs.filter(l => l.habitId === habit.id)
        const uniqueDays = new Set(logs.map(l => l.date)).size
        lines.push(`- ${habit.name} (${habit.kind}): ${uniqueDays} days logged, target ${habit.targetPerDay ?? 1}/day`)
      })
      lines.push('')
    }

    // Pending Tasks
    const pendingTasks = data.assignments.filter(a => !a.completed && !a.deletedAt)
    if (pendingTasks.length > 0) {
      lines.push('## Pending Tasks')
      pendingTasks.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
      pendingTasks.slice(0, 15).forEach(task => {
        const dueStr = task.dueDate ? ` (due ${task.dueDate})` : ''
        const subject = data.subjects.find(s => s.id === task.subjectId)
        lines.push(`- ${task.title}${dueStr} [${subject?.name ?? 'Unknown'}]`)
      })
      if (pendingTasks.length > 15) lines.push(`- ... and ${pendingTasks.length - 15} more`)
      lines.push('')
    }

    // Session notes (recent sessions with notes or focus tags)
    const detailedSessions = weekSessions.filter(s => (s.note && s.note.trim() !== '') || s.focusTag)
    if (detailedSessions.length > 0) {
      lines.push('## Session Notes & Focus Quality')
      detailedSessions.forEach(s => {
        const subj = data.subjects.find(sub => sub.id === s.subjectId)
        const subjName = subj?.name ?? 'Unknown'
        const date = format(parseISO(s.startAt), 'MMM d')
        const time = format(parseISO(s.startAt), 'h:mm a')
        const parts = [`- ${date} ${time} | ${subjName} | ${formatMinutes(s.durationMinutes)}`]
        if (s.focusTag) parts.push(`Focus: ${s.focusTag}`)
        if (s.note && s.note.trim() !== '') parts.push(`Note: ${s.note.trim()}`)
        lines.push(parts.join(' '))
      })
      lines.push('')
    }

    lines.push('Please analyse:')
    lines.push('1. Overall productivity and consistency')
    lines.push('2. Balance across subjects')
    lines.push('3. Session length patterns')
    lines.push('4. Suggestions for improving study habits')
    lines.push('5. Any areas where I\'m over/under-investing time')
    lines.push('6. Recommendations for next week\'s study schedule')
    lines.push('7. Patterns from session notes and focus quality (e.g. recurring challenges, strengths, problem topics)')
    return lines.join('\n')
  }, [dateRange, stats, settings.dailyTargetMinutes, data.habits, data.habitLogs, data.assignments, data.subjects, weekSessions])
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(aiPrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset)
    setShowCustom(false)
  }

  if (isLoading) return <PageSpinner />

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Select Date Range</CardTitle>
        </CardHeader>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={datePreset === 'thisWeek' && !showCustom ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => handlePresetChange('thisWeek')}
          >
            This Week
          </Button>
          <Button
            variant={datePreset === 'lastWeek' && !showCustom ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => handlePresetChange('lastWeek')}
          >
            Last Week
          </Button>
          <Button
            variant={datePreset === 'last2Weeks' && !showCustom ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => handlePresetChange('last2Weeks')}
          >
            Last 2 Weeks
          </Button>
          <Button
            variant={showCustom ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setShowCustom(!showCustom)}
          >
            Custom
          </Button>
        </div>

        {showCustom && (
          <div className="mt-4 flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-600 dark:text-slate-400">Start Date</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="input"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-600 dark:text-slate-400">End Date</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="input"
              />
            </div>
          </div>
        )}
      </Card>

      {/* Stats Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Week Summary</CardTitle>
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <div className="text-sm text-slate-500 dark:text-slate-400">Total Time</div>
            <div className="text-xl font-semibold text-slate-800 dark:text-slate-100">
              {formatMinutes(stats.totalMinutes)}
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-500 dark:text-slate-400">Sessions</div>
            <div className="text-xl font-semibold text-slate-800 dark:text-slate-100">
              {stats.totalSessions}
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-500 dark:text-slate-400">Avg Session</div>
            <div className="text-xl font-semibold text-slate-800 dark:text-slate-100">
              {stats.avgSessionLength}m
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-500 dark:text-slate-400">Streak</div>
            <div className="text-xl font-semibold text-slate-800 dark:text-slate-100">
              {stats.currentStreak} days
            </div>
          </div>
        </div>
      </Card>

      {/* Generated Prompt */}
      <Card>
        <CardHeader>
          <CardTitle>AI Review Prompt</CardTitle>
        </CardHeader>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          Copy this prompt and paste it into ChatGPT, Gemini, Claude, or any AI assistant for a detailed weekly review.
        </p>
        <textarea
          readOnly
          value={aiPrompt}
          className={cn(
            'w-full h-96 resize-none rounded-md border p-3 text-sm font-mono',
            'bg-slate-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100',
            'border-slate-200 dark:border-slate-700',
            'focus:outline-none focus:ring-2 focus:ring-primary-500'
          )}
        />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Button variant="primary" onClick={handleCopy}>
            {copied ? '✓ Copied!' : 'Copy to Clipboard'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => window.open(`https://chatgpt.com/?q=${encodeURIComponent(aiPrompt)}`, '_blank', 'noopener,noreferrer')}
          >
            Open in ChatGPT
          </Button>
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <Button
              variant="secondary"
              onClick={() => navigator.share({ title: 'Study Review', text: aiPrompt }).catch(() => {})}
            >
              Share
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}