import { useState, useRef, useEffect, useMemo } from 'react'
import { format, subDays, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, parseISO } from 'date-fns'
import { useData } from '../../app/providers'
import { db } from '../../db/app-db'
import { loadSettings } from '../../lib/settings-store'
import { cn, isoNow, sessionLocalDate, softDelete, STREAK_MILESTONES } from '../../lib/utils'
import { useUndo } from '../../lib/use-undo'
import { Button } from '../../components/ui/Button'
import { Card, CardHeader, CardTitle } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { ColorPicker } from '../../components/ui/ColorPicker'
import { v4 as uuid } from 'uuid'
import { Collapsible } from '../../components/ui/Collapsible'
import type { Habit, HabitLog } from '../../domain/types'

const DEFAULT_COLOR = '#6366f1'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']


export default function HabitsPage() {
  const { data, mutate } = useData()
  const { push: pushUndo } = useUndo()
  const settings = loadSettings()
  // Local optimistic overlay for habit logs — written to Dexie, then reflected
  // here instantly so the UI updates before loadData() finishes.
  const [localLogAdditions, setLocalLogAdditions] = useState<HabitLog[]>([])
  const [localLogDeletions, setLocalLogDeletions] = useState<Set<string>>(new Set())
  const effectiveHabitLogs = useMemo(
    () => data.habitLogs
      .filter((l) => !l.deletedAt && !localLogDeletions.has(l.id))
      .concat(localLogAdditions),
    [data.habitLogs, localLogAdditions, localLogDeletions],
  )
  // Debounce guard for quickLogToday: prevents double-click race conditions
  // when toggling tick-mode habits.
  const quickLogInFlightRef = useRef<Set<string>>(new Set())

  // Re-fetch latest habit data to avoid stale closure issues
  const latestDataRef = useRef(data)
  useEffect(() => { latestDataRef.current = data }, [data])

  const [showModal, setShowModal] = useState(false)
  const [editHabit, setEditHabit] = useState<Habit | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Habit['kind']>('good')
  const [habitMode, setHabitMode] = useState<Habit['mode']>('count')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [archivedAfterDays, setArchivedAfterDays] = useState<number | null>(null)
  const [targetPerDay, setTargetPerDay] = useState(1)
  const [newHabitStatus, setNewHabitStatus] = useState<'active' | 'potential'>('active')
  const [parkForLater, setParkForLater] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [archiveConfirm, setArchiveConfirm] = useState<string | null>(null)
  const [finishConfirm, setFinishConfirm] = useState<string | null>(null)
  const [resetConfirm, setResetConfirm] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null)
  // Tracks whether we opened the add-log modal from the day detail modal,
  // so we can close the day detail after saveLog() succeeds.
  const [editLogCameFromDayDetail, setEditLogCameFromDayDetail] = useState(false)
  
  const [showAddLog, setShowAddLog] = useState(false)
  const [logDate, setLogDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [logTime, setLogTime] = useState('')
  const [logNote, setLogNote] = useState('')
  const [logValue, setLogValue] = useState('')
  const [editLog, setEditLog] = useState<HabitLog | null>(null)
  
  const [calendarMonth, setCalendarMonth] = useState(new Date())

  // NOTE: hooks must be called unconditionally on every render — do NOT early-return before them.
  const selectedHabitLogs = useMemo(() => {
    if (!selectedId) return []
    return effectiveHabitLogs
      .filter((l) => l.habitId === selectedId && !l.deletedAt)
      .sort((a, b) => {
        const dateCmp = b.date.localeCompare(a.date)
        if (dateCmp !== 0) return dateCmp
        return (b.time || '').localeCompare(a.time || '')
      })
  }, [effectiveHabitLogs, selectedId])
  const archivedHabits = data.habits.filter((h) => !!h.archivedAt && !h.deletedAt)
  const finishedHabits = data.habits.filter((h) => !!h.finishedAt && !h.archivedAt && !h.deletedAt)
  // Active = not archived, not finished, and not parked as a potential habit
  const currentHabits = data.habits.filter((h) => !h.archivedAt && !h.finishedAt && h.status !== 'potential' && !h.deletedAt)
  const potentialHabits = data.habits.filter((h) => !h.archivedAt && !h.finishedAt && h.status === 'potential' && !h.deletedAt)
  const goodHabits = currentHabits.filter((h) => h.kind === 'good')
  const badHabits = currentHabits.filter((h) => h.kind === 'bad')
  const selectedHabit = data.habits.find((h) => h.id === selectedId && !h.deletedAt) ?? null
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  // Check if we are over the habit limit
  const habitLimit = settings.maxActiveHabits
  const overLimit = currentHabits.length >= habitLimit


  const logsByDate = useMemo(() => {
    const groups: Record<string, HabitLog[]> = {}
    selectedHabitLogs.forEach((log) => {
      if (!groups[log.date]) groups[log.date] = []
      groups[log.date].push(log)
    })
    return groups
  }, [selectedHabitLogs])

  // Pre-compute streaks for every habit in one pass (each streak iterates up to 365 days).
  const streakMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const habit of data.habits) {
      const isBad = habit.kind === 'bad'
      if (isBad && habit.createdAt) {
        const createdDate = format(new Date(habit.createdAt), 'yyyy-MM-dd')
        if (todayStr === createdDate) { map.set(habit.id, 0); continue }
      }
      const logDates = new Set(effectiveHabitLogs.filter((l) => l.habitId === habit.id).map((l) => l.date))
      const habitStart = habit.createdAt ? new Date(habit.createdAt) : null
      const daysSinceCreation = habitStart
        ? Math.max(0, Math.floor((Date.now() - habitStart.getTime()) / 86400000))
        : 365
      const maxDays = Math.min(365, daysSinceCreation)
      const todayCutoff = isBad ? subDays(new Date(), 1) : new Date()
      let streak = 0
      let missed = 0
      let d = todayCutoff
      while (streak < maxDays) {
        if (habitStart && d < subDays(habitStart, 1)) break
        const ds = format(d, 'yyyy-MM-dd')
        const countsAsStreak = isBad ? !logDates.has(ds) : logDates.has(ds)
        if (countsAsStreak) {
          streak++
          missed = 0
          d = subDays(d, 1)
        } else {
          if (isBad) break
          missed++
          if (missed > 1) break
          d = subDays(d, 1)
        }
      }
      map.set(habit.id, streak)
    }
    return map
  }, [data.habits, effectiveHabitLogs, todayStr])

  function getTodayCount(habitId: string): number {
    return effectiveHabitLogs.filter((l) => l.habitId === habitId && l.date === todayStr).length
  }
  function getDaysLogged(habitId: string): number {
    const uniqueDays = new Set(effectiveHabitLogs.filter((l) => l.habitId === habitId).map((l) => l.date))
    return uniqueDays.size
  }
  function getForgivenDates(habitId: string): Set<string> {
    const habit = data.habits.find((h) => h.id === habitId)
    if (!habit || habit.kind === 'bad') return new Set()
    const logDates = new Set(effectiveHabitLogs.filter((l) => l.habitId === habitId).map((l) => l.date))
    const forgiven = new Set<string>()
    let streak = 0
    let missed = 0
    let d = new Date()
    const maxDays = habit.createdAt
      ? Math.min(365, Math.ceil((Date.now() - new Date(habit.createdAt).getTime()) / 86400000))
      : 365
  while (streak < maxDays) {
    const ds = format(d, 'yyyy-MM-dd')
    if (logDates.has(ds)) {
      streak++
      missed = 0
      d = subDays(d, 1)
    } else {
      missed++
      if (missed > 1) break
      if (missed === 1) forgiven.add(ds)
      d = subDays(d, 1)
    }
  }
  return forgiven
}
  async function quickLogToday(habitId: string) {
    if (quickLogInFlightRef.current.has(habitId)) return
    quickLogInFlightRef.current.add(habitId)
    try {
      const live = latestDataRef.current
      const habit = live.habits.find((h) => h.id === habitId)
      const now = new Date()
      const todayDate = format(now, 'yyyy-MM-dd')
      const isTick = habit?.mode === 'tick'
      const subject = habit?.kind === 'bad' ? `Quitting ${habit?.name ?? 'habit'}` : (habit?.name ?? 'habit')
      if (isTick) {
        // Check effectiveHabitLogs (includes optimistic local additions) so a
        // just-added log is seen immediately — prevents duplicate logs on
        // rapid re-click.
        const existing = effectiveHabitLogs.find((l) => l.habitId === habitId && l.date === todayDate)
        if (existing) {
          setLocalLogDeletions((prev) => new Set(prev).add(existing.id))
          try {
            await db.habitLogs.delete(existing.id)
            mutate(prev => ({ ...prev, habitLogs: prev.habitLogs.filter(l => l.id !== existing.id) }))
            pushUndo({
              description: `Unchecked: ${subject}`,
              undo: async () => { await db.habitLogs.put(existing); mutate(prev => ({ ...prev, habitLogs: [...prev.habitLogs, existing] })) },
              redo: async () => { await db.habitLogs.delete(existing.id); mutate(prev => ({ ...prev, habitLogs: prev.habitLogs.filter(l => l.id !== existing.id) })) },
            })
          } catch (e) {
            setLocalLogDeletions((prev) => { const next = new Set(prev); next.delete(existing.id); return next })
            throw e
          }
        } else {
          const newLog = { id: uuid(), habitId, date: todayDate, time: format(now, 'HH:mm'), createdAt: isoNow(), updatedAt: isoNow() }
          setLocalLogAdditions((prev) => [...prev, newLog])
          try {
            await db.habitLogs.add(newLog)
            mutate(prev => ({ ...prev, habitLogs: [...prev.habitLogs, newLog] }))
            pushUndo({
              description: `Ticked: ${subject}`,
              undo: async () => { await db.habitLogs.delete(newLog.id); mutate(prev => ({ ...prev, habitLogs: prev.habitLogs.filter(l => l.id !== newLog.id) })) },
              redo: async () => { await db.habitLogs.add(newLog); mutate(prev => ({ ...prev, habitLogs: [...prev.habitLogs, newLog] })) },
            })
          } catch (e) {
            setLocalLogAdditions((prev) => prev.filter((l) => l.id !== newLog.id))
            throw e
          }
        }
        return
      }
      const newLog = { id: uuid(), habitId, date: todayDate, time: format(now, 'HH:mm'), createdAt: isoNow(), updatedAt: isoNow() }
      setLocalLogAdditions((prev) => [...prev, newLog])
      try {
        await db.habitLogs.add(newLog)
        mutate(prev => ({ ...prev, habitLogs: [...prev.habitLogs, newLog] }))
        pushUndo({
          description: `Logged ${habit?.kind === 'bad' ? 'lapse' : 'occurrence'}: ${subject}`,
          undo: async () => { await db.habitLogs.delete(newLog.id); mutate(prev => ({ ...prev, habitLogs: prev.habitLogs.filter(l => l.id !== newLog.id) })) },
          redo: async () => { await db.habitLogs.add(newLog); mutate(prev => ({ ...prev, habitLogs: [...prev.habitLogs, newLog] })) },
        })
      } catch (e) {
        setLocalLogAdditions((prev) => prev.filter((l) => l.id !== newLog.id))
        throw e
      }
    } finally {
      quickLogInFlightRef.current.delete(habitId)
    }
  }

  async function saveLog() {
    if (!selectedId) return
    const habit = data.habits.find((h) => h.id === selectedId)
    const parsedValue = logValue.trim() ? (isNaN(Number(logValue)) ? undefined : Number(logValue)) : undefined
    try {
      if (editLog) {
        const prevLog = await db.habitLogs.get(editLog.id)
        // Avoid writing undefined fields — Firestore rejects them and Dexie can lose them
        const update: Partial<HabitLog> = { date: logDate, updatedAt: isoNow() }
        if (logTime) update.time = logTime
        if (logNote.trim()) update.note = logNote.trim()
        if (parsedValue !== undefined) update.value = parsedValue
        await db.habitLogs.update(editLog.id, update)
        mutate(prev => ({ ...prev, habitLogs: prev.habitLogs.map(l => l.id === editLog.id ? { ...l, ...update } : l) }))
        if (editLogCameFromDayDetail) {
          setDayDetailDate(null)
          setEditLogCameFromDayDetail(false)
        }
        setShowAddLog(false)
        setEditLog(null)
        if (prevLog) {
          pushUndo({
            description: `Edited log for "${habit?.name ?? 'habit'}"`,
            undo: async () => { await db.habitLogs.update(editLog.id, prevLog); mutate(prev => ({ ...prev, habitLogs: prev.habitLogs.map(l => l.id === editLog.id ? { ...prevLog, ...l } : l) })) },
            redo: async () => { await db.habitLogs.update(editLog.id, { date: logDate, time: logTime || undefined, note: logNote.trim() || undefined, value: parsedValue, updatedAt: isoNow() }); mutate(prev => ({ ...prev, habitLogs: prev.habitLogs.map(l => l.id === editLog.id ? { ...l, date: logDate, time: logTime || undefined, note: logNote.trim() || undefined, value: parsedValue, updatedAt: isoNow() } : l) })) },
          })
        }
      } else {
        const newLog: HabitLog = {
          id: uuid(),
          habitId: selectedId,
          date: logDate,
          createdAt: isoNow(),
          updatedAt: isoNow(),
        }
        if (logTime) newLog.time = logTime
        if (logNote.trim()) newLog.note = logNote.trim()
        if (parsedValue !== undefined) newLog.value = parsedValue
        await db.habitLogs.add(newLog)
        mutate(prev => ({ ...prev, habitLogs: [...prev.habitLogs, newLog] }))
        if (editLogCameFromDayDetail) {
          setDayDetailDate(null)
          setEditLogCameFromDayDetail(false)
        }
        setShowAddLog(false)
        setEditLog(null)
        const saveLogVerb = habit?.mode === 'tick' ? 'ticked' : (habit?.kind === 'bad' ? 'lapse' : 'occurrence')
        const saveLogSubject = habit?.kind === 'bad' && habit ? `Quitting ${habit.name}` : (habit?.name ?? 'habit')
        pushUndo({
          description: `Logged ${saveLogVerb}: ${saveLogSubject}`,
          undo: async () => { await db.habitLogs.delete(newLog.id); mutate(prev => ({ ...prev, habitLogs: prev.habitLogs.filter(l => l.id !== newLog.id) })) },
          redo: async () => { await db.habitLogs.add(newLog); mutate(prev => ({ ...prev, habitLogs: [...prev.habitLogs, newLog] })) },
        })
      }
    } catch (e) { console.error('Failed to save log', e) }
  }

  async function deleteLog(log: HabitLog) {
    try {
      await db.habitLogs.delete(log.id)
      mutate(prev => ({ ...prev, habitLogs: prev.habitLogs.filter(l => l.id !== log.id) }))
      pushUndo({
        description: `Deleted log${log.note ? `: ${log.note}` : ''}`,
        undo: async () => { await db.habitLogs.add(log); mutate(prev => ({ ...prev, habitLogs: [...prev.habitLogs, log] })) },
        redo: async () => { await db.habitLogs.delete(log.id); mutate(prev => ({ ...prev, habitLogs: prev.habitLogs.filter(l => l.id !== log.id) })) },
      })
    } catch (e) { console.error('Failed to delete log', e) }
  }
  function openAddLog(log?: HabitLog) {
    setEditLog(log || null)
    setLogDate(log ? log.date : todayStr)
    setLogTime(log?.time || format(new Date(), 'HH:mm'))
    setLogNote(log?.note || '')
    setLogValue(log?.value?.toString() ?? '')
    setShowAddLog(true)
  }


  function openAddHabit() {
    if (overLimit) {
      const ok = window.confirm(
        `You already have ${currentHabits.length} active habits. ` +
        `Research suggests 1–3 habits at a time is optimal — focusing on fewer habits ` +
        `gives you a much better chance of sticking with them long-term.` +
        `\n\nAdd another anyway?`
      )
      if (!ok) return
    }
    setEditHabit(null)
    setName('')
    setKind('good')
    setColor(DEFAULT_COLOR)
    setArchivedAfterDays(settings.defaultArchiveDays)
    setTargetPerDay(1)
    setNewHabitStatus('active')
    setParkForLater(false)
    setShowModal(true)
  }


  function openEditHabit(habit: Habit) {
    setEditHabit(habit)
    setName(habit.name)
    setKind(habit.kind)
    setColor(habit.color)
    setArchivedAfterDays(habit.archivedAfterDays ?? null)
    setTargetPerDay(habit.targetPerDay ?? 1)
    setShowModal(true)
  }
  async function saveHabit() {
    if (!name.trim()) return
    try {
      const trimmed = name.trim()
      const finalName = kind === 'bad' && !trimmed.startsWith('Quitting ') ? `Quitting ${trimmed}` : trimmed
      const status: 'active' | 'potential' = parkForLater ? 'potential' : newHabitStatus
      if (editHabit) {
        const updated = { name: finalName, kind, mode: habitMode, color, archivedAfterDays, targetPerDay, updatedAt: isoNow() }
        await db.habits.update(editHabit.id, updated)
        mutate(prev => ({ ...prev, habits: prev.habits.map(h => h.id === editHabit.id ? { ...h, ...updated } : h) }))
      } else {
        const newHabit = { id: uuid(), name: finalName, kind, mode: habitMode, color, archivedAfterDays, targetPerDay, status, createdAt: isoNow(), updatedAt: isoNow() }
        await db.habits.add(newHabit)
        mutate(prev => ({ ...prev, habits: [...prev.habits, newHabit] }))
      }
      setShowModal(false)
    } catch (e) { console.error('Failed to save habit', e) }
  }
  async function promoteHabit(id: string) {
    await db.habits.update(id, { status: 'active', updatedAt: isoNow() })
    mutate(prev => ({ ...prev, habits: prev.habits.map(h => h.id === id ? { ...h, status: 'active', updatedAt: isoNow() } : h) }))
  }
  async function archiveHabitFn(id: string) {
    try {
      await db.habits.update(id, { archivedAt: isoNow(), updatedAt: isoNow() })
      if (selectedId === id) setSelectedId(null)
      setArchiveConfirm(null)
      mutate(prev => ({ ...prev, habits: prev.habits.map(h => h.id === id ? { ...h, archivedAt: isoNow(), updatedAt: isoNow() } : h) }))
    } catch (e) { console.error('Failed to archive habit', e) }
  }
  async function unarchiveHabitFn(id: string) {
    try {
      await db.habits.update(id, { archivedAt: null, updatedAt: isoNow() })
      mutate(prev => ({ ...prev, habits: prev.habits.map(h => h.id === id ? { ...h, archivedAt: null, updatedAt: isoNow() } : h) }))
    } catch (e) { console.error('Failed to unarchive habit', e) }
  }

  async function deleteHabitFn(id: string) {
    // Snapshot the habit and its logs before deleting
    const habit = await db.habits.get(id)
    const logs = await db.habitLogs.where('habitId').equals(id).toArray()
    if (!habit) return
    // Soft-delete the habit
    await softDelete(db.habits, id)
    // Soft-delete all associated logs
    const now = isoNow()
    for (const log of logs) {
      await db.habitLogs.update(log.id, { deletedAt: now, updatedAt: now })
    }
    if (selectedId === id) setSelectedId(null)
    setDeleteConfirm(null)
    mutate(prev => ({ ...prev, habits: prev.habits.map(h => h.id === id ? { ...h, deletedAt: now, updatedAt: now } : h), habitLogs: prev.habitLogs.map(l => logs.some(lo => lo.id === l.id) ? { ...l, deletedAt: now, updatedAt: now } : l) }))
    pushUndo({
      description: `Deleted habit "${habit.name}"`,
        undo: async () => {
          await db.habits.put({ ...habit, deletedAt: null, updatedAt: isoNow() })
          for (const l of logs) {
            await db.habitLogs.put({ ...l, deletedAt: null, updatedAt: isoNow() })
          }
          mutate(prev => ({ ...prev, habits: prev.habits.map(h => h.id === id ? { ...habit, deletedAt: null, updatedAt: isoNow() } : h), habitLogs: prev.habitLogs.map(l => logs.some(lo => lo.id === l.id) ? { ...l, deletedAt: null, updatedAt: isoNow() } : l) }))
        },
        redo: async () => {
          const redoNow = isoNow()
          await db.habits.update(id, { deletedAt: redoNow, updatedAt: redoNow })
          for (const l of logs) {
            await db.habitLogs.update(l.id, { deletedAt: redoNow, updatedAt: redoNow })
          }
          mutate(prev => ({ ...prev, habits: prev.habits.map(h => h.id === id ? { ...h, deletedAt: redoNow, updatedAt: redoNow } : h), habitLogs: prev.habitLogs.map(l => logs.some(lo => lo.id === l.id) ? { ...l, deletedAt: redoNow, updatedAt: redoNow } : l) }))
        },
    })
  }
  async function finishHabitFn(id: string) {
    try {
      await db.habits.update(id, { finishedAt: isoNow(), updatedAt: isoNow() })
      if (selectedId === id) setSelectedId(null)
      setFinishConfirm(null)
      mutate(prev => ({ ...prev, habits: prev.habits.map(h => h.id === id ? { ...h, finishedAt: isoNow(), updatedAt: isoNow() } : h) }))
    } catch (e) { console.error('Failed to finish habit', e) }
  }
  async function unfinishHabitFn(id: string) {
    try {
      await db.habits.update(id, { finishedAt: null, updatedAt: isoNow() })
      mutate(prev => ({ ...prev, habits: prev.habits.map(h => h.id === id ? { ...h, finishedAt: null, updatedAt: isoNow() } : h) }))
    } catch (e) { console.error('Failed to unfinish habit', e) }
  }
  async function resetHabitDataFn(id: string) {
    try {
      const logs = await db.habitLogs.where('habitId').equals(id).toArray()
      const now = isoNow()
      if (logs.length > 0) {
        // Bulk update instead of sequential await per log — eliminates the
        // lag that made the page feel unresponsive during reset.
        await db.habitLogs.bulkUpdate(logs.map(l => ({ key: l.id, changes: { deletedAt: now, updatedAt: now } })))
      }
      // Clear optimistic overlays for this habit so locally-added logs don't
      // reappear after the reset.
      setLocalLogAdditions((prev) => prev.filter((l) => l.habitId !== id))
      setLocalLogDeletions((prev) => {
        const next = new Set(prev)
        for (const l of logs) next.add(l.id)
        return next
      })
      setResetConfirm(null)
      mutate(prev => ({ ...prev, habitLogs: prev.habitLogs.map(l => logs.some(lo => lo.id === l.id) ? { ...l, deletedAt: now, updatedAt: now } : l) }))
    } catch (e) { console.error('Failed to reset habit data', e) }
  }

  const calendarDays = useMemo(() => {
    const start = startOfMonth(calendarMonth)
    const end = endOfMonth(calendarMonth)
    return eachDayOfInterval({ start, end })
  }, [calendarMonth])

  const calendarStartDay = getDay(startOfMonth(calendarMonth))

  function HabitCard({ habit }: { habit: Habit }) {
    const isBad = habit.kind === 'bad'
    const streak = streakMap.get(habit.id) ?? 0
    const todayCount = getTodayCount(habit.id)
    const daysLogged = getDaysLogged(habit.id)
    const archiveThreshold = habit.archivedAfterDays ?? settings.defaultArchiveDays
    const reachedThreshold = daysLogged >= archiveThreshold
    const isTickMode = habit.mode === 'tick'
    const isTickedToday = isTickMode && todayCount > 0
    const isMenuOpen = openMenuId === habit.id
    const menuRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
      if (!isMenuOpen) return
      const handler = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null)
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setOpenMenuId(null)
      }
      document.addEventListener('mousedown', handler)
      document.addEventListener('keydown', onKey)
      return () => {
        document.removeEventListener('mousedown', handler)
        document.removeEventListener('keydown', onKey)
      }
    }, [isMenuOpen])
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = subDays(new Date(), 6 - i)
      const ds = format(d, 'yyyy-MM-dd')
      const hasLog = effectiveHabitLogs.some((l) => l.habitId === habit.id && l.date === ds)
      const daysAgo = 6 - i
      const isForgiven = !isBad && !hasLog && streak > 0 && streak > daysAgo
      return { date: ds, hasLog, isForgiven }
    })
    const streakLabel = isBad
      ? (streak > 0 ? `✓ ${streak} day streak of avoiding` : 'No streak yet')
      : (streak > 0 ? `🔥 ${streak} day streak` : 'No streak yet')
    return (
      <Card
        className={cn('cursor-pointer transition-shadow hover:shadow-md', selectedId === habit.id && 'ring-2 ring-primary-500')}
        onClick={() => setSelectedId(habit.id === selectedId ? null : habit.id)}
      >
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: habit.color }} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-800 dark:text-slate-100">{habit.name}</span>
              {isBad && (
                <span
                  className="cursor-help text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  title="For bad habits, the streak counts days you DIDN'T do it. Logging a bad habit means logging that you did the bad thing. The goal is to keep the streak growing."
                  aria-label="About bad habit streaks"
                >ⓘ</span>
              )}
              {isTickMode && (
                <span
                  className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                  title="Tick mode: one log per day"
                >tick</span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {streakLabel}
              <span className="mx-1">·</span>
              {daysLogged} {isBad ? 'lapses' : 'days logged'}
              {!isBad && streak > 0 && (
                <>
                  <span className="mx-1">·</span>
                  {STREAK_MILESTONES.filter((m) => streak >= m).map((m) => (
                    <span key={m} className="mx-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">{m}d</span>
                  ))}
                </>
              )}
            </div>
          </div>
          {!isTickMode && todayCount > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium dark:bg-slate-700">{todayCount} today</span>
          )}
          {/* Kebab menu */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="Habit actions"
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              onClick={(e) => { e.stopPropagation(); setOpenMenuId(isMenuOpen ? null : habit.id) }}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <circle cx="3" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="13" cy="8" r="1.5" />
              </svg>
            </button>
            {isMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => { setOpenMenuId(null); setFinishConfirm(habit.id) }}
                >Mark as Done</button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => { setOpenMenuId(null); setArchiveConfirm(habit.id) }}
                >Pause</button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => { setOpenMenuId(null); openEditHabit(habit) }}
                >Edit</button>
                <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => { setOpenMenuId(null); setResetConfirm(habit.id) }}
                >Reset Data</button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                  onClick={() => { setOpenMenuId(null); setDeleteConfirm(habit.id) }}
                >Delete</button>
              </div>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex gap-1">
            {last7.map((d) => (
              <div
                key={d.date}
                className={cn('h-2.5 w-2.5 rounded-full', !d.hasLog && !d.isForgiven && 'bg-slate-200 dark:bg-slate-700', d.isForgiven && 'opacity-50')}
                style={d.hasLog ? { backgroundColor: habit.color } : d.isForgiven ? { backgroundColor: habit.color, opacity: 0.5 } : undefined}
                title={`${d.date}${d.isForgiven ? ' (forgiven)' : ''}${isBad && d.hasLog ? ' (lapse)' : ''}`}
              />
            ))}
          </div>
          <div className="flex gap-1">
            {isTickMode ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void quickLogToday(habit.id) }}
                aria-pressed={isTickedToday}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded border-2 text-base font-bold transition-colors',
                  isTickedToday
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-slate-300 bg-white text-slate-400 hover:border-primary-400 hover:text-primary-500 dark:border-slate-600 dark:bg-slate-800'
                )}
                title={isTickedToday ? 'Uncheck for today' : 'Check for today'}
              >
                ✓
              </button>
            ) : (
              <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); void quickLogToday(habit.id) }}>
                Quick Log
              </Button>
            )}
            {!isTickMode && (
              <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedId(habit.id); openAddLog() }}>
                {isBad ? 'Log lapse' : 'Log with note'}
              </Button>
            )}
          </div>
        </div>

        {/* Suggestion to archive for good habits only */}
        {!isBad && reachedThreshold && (
          <p className="mt-2 text-xs text-green-600 dark:text-green-400">
            🎉 {archiveThreshold} day{archiveThreshold === 1 ? '' : 's'} done — this habit may now be automatic. Consider{' '}
            <button
              onClick={(e) => { e.stopPropagation(); setArchiveConfirm(habit.id) }}
              className="underline hover:text-green-800"
            >archiving</button>.
          </p>
        )}
      </Card>
    )
  }
  // N — Add new habit
  useEffect(() => {
    function onAdd() { setShowModal(true) }
    window.addEventListener('momentum:habits-add', onAdd)
    return () => window.removeEventListener('momentum:habits-add', onAdd)
  }, [])

  // Space — Toggle today's check-in for selected habit
  useEffect(() => {
    function onToggleToday() {
      const habit = currentHabits[selectedIndex]
      if (habit) quickLogToday(habit.id)
    }
    window.addEventListener('momentum:habits-toggle-today', onToggleToday)
    return () => window.removeEventListener('momentum:habits-toggle-today', onToggleToday)
  }, [selectedIndex, currentHabits])

  // A — Archive selected
  useEffect(() => {
    function onArchive() {
      const habit = currentHabits[selectedIndex]
      if (habit) archiveHabitFn(habit.id)
    }
    window.addEventListener('momentum:habits-archive', onArchive)
    return () => window.removeEventListener('momentum:habits-archive', onArchive)
  }, [selectedIndex, currentHabits])

  // ↑ / ↓ — Navigate list
  useEffect(() => {
    function onPrev() { setSelectedIndex((i) => Math.max(0, i - 1)) }
    function onNext() { setSelectedIndex((i) => Math.min(currentHabits.length - 1, i + 1)) }
    window.addEventListener('momentum:habits-prev', onPrev)
    window.addEventListener('momentum:habits-next', onNext)
    return () => {
      window.removeEventListener('momentum:habits-prev', onPrev)
      window.removeEventListener('momentum:habits-next', onNext)
    }
  }, [currentHabits.length])

  // 1-7 — Select habit by position
  useEffect(() => {
    function onSelect(e: Event) {
      const pos = (e as CustomEvent).detail as number
      if (pos >= 1 && pos <= currentHabits.length) {
        setSelectedIndex(pos - 1)
      }
    }
    window.addEventListener('momentum:habits-select', onSelect)
    return () => window.removeEventListener('momentum:habits-select', onSelect)
  }, [currentHabits.length])


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Habits</h2>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={openAddHabit}>Add Habit</Button>
        </div>
      </div>


      <Collapsible id="good-habits" title="Good Habits" count={goodHabits.length} defaultOpen={true} accent="#22c55e">
        {goodHabits.length === 0 ? <EmptyState title="No good habits" description="Track positive habits you want to build." /> : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{goodHabits.map((h) => <HabitCard key={h.id} habit={h} />)}</div>
        )}
      </Collapsible>
      <Collapsible id="bad-habits" title="Bad Habits" count={badHabits.length} defaultOpen={true} accent="#ef4444">
        {badHabits.length === 0 ? <EmptyState title="No bad habits" description="Track habits you want to avoid." /> : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{badHabits.map((h) => <HabitCard key={h.id} habit={h} />)}</div>
        )}
      </Collapsible>
      {potentialHabits.length > 0 && (
        <Collapsible id="potential-habits" title="Potential Habits" count={potentialHabits.length} defaultOpen={false} accent="#f59e0b">
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            On the wishlist — pick these up when you've got room.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {potentialHabits.map((h) => (
              <Card key={h.id} className="opacity-80">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: h.color }} />
                  <div className="flex-1 font-medium text-slate-700 dark:text-slate-200">{h.name}</div>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    {h.kind === 'good' ? 'Good' : 'Bad'}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  <Button variant="primary" size="sm" onClick={() => promoteHabit(h.id)}>Promote</Button>
                  <Button variant="secondary" size="sm" onClick={() => openEditHabit(h)}>Edit</Button>
                  <Button variant="danger" size="sm" onClick={() => setDeleteConfirm(h.id)}>Delete</Button>
                </div>
              </Card>
            ))}
          </div>
        </Collapsible>
      )}

      {archivedHabits.length > 0 && (
        <Collapsible id="archived-habits" title={`Archived Habits`} count={archivedHabits.length} defaultOpen={false} accent="#64748b">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {archivedHabits.map((h) => (
              <Card key={h.id} className="opacity-75">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-slate-700 dark:text-slate-300">{h.name} (Archived)</div>
                  <Button variant="secondary" size="sm" onClick={() => unarchiveHabitFn(h.id)}>Restore</Button>
                </div>
              </Card>
            ))}
          </div>
        </Collapsible>
      )}

      {finishedHabits.length > 0 && (
        <Collapsible id="finished-habits" title="Finished Habits" count={finishedHabits.length} defaultOpen={false} accent="#0f766e">
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Habits you no longer need to track, kept for reference.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {finishedHabits.map((h) => (
              <Card key={h.id} className="opacity-80">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-700 dark:text-slate-300">{h.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Done{h.finishedAt ? ` · ${sessionLocalDate(h.finishedAt)}` : ''}</div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="secondary" size="sm" onClick={() => unfinishHabitFn(h.id)}>Restore</Button>
                    <Button variant="danger" size="sm" onClick={() => setDeleteConfirm(h.id)}>Delete</Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Collapsible>
      )}

      {selectedHabit && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                <span className="mr-2 inline-block h-3 w-3 rounded-full" style={{ backgroundColor: selectedHabit.color }} />
                {selectedHabit.name}
              </CardTitle>
              <span className={cn('rounded px-2 py-0.5 text-xs font-medium', selectedHabit.kind === 'good' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                {selectedHabit.kind === 'good' ? 'Good' : 'Bad'}
              </span>
            </div>
          </CardHeader>

          <div className="mb-4 flex gap-4 text-sm text-slate-600">
            <div><span className="font-semibold">{streakMap.get(selectedHabit.id) ?? 0}</span> day streak</div>
            <div><span className="font-semibold">{selectedHabitLogs.length}</span> total logs</div>
          </div>

          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <button onClick={() => setCalendarMonth(subMonths(calendarMonth, 1))} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700">←</button>
              <span className="font-medium">{format(calendarMonth, 'MMMM yyyy')}</span>
              <button onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700">→</button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {WEEKDAYS.map((day) => <div key={day} className="py-1 font-medium text-slate-500">{day}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: calendarStartDay }).map((_, i) => <div key={`empty-${i}`} />)}
              {(() => {
                const forgivenDates = getForgivenDates(selectedHabit.id)
                const habitStartDate = sessionLocalDate(selectedHabit.createdAt)
                return calendarDays.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd')
                const dayLogs = logsByDate[dateStr] ?? []
                const count = dayLogs.length
                const totalValue = dayLogs.reduce((sum, l) => sum + (l.value ?? 0), 0)
                const isTickMode = selectedHabit.mode === 'tick'
                const target = selectedHabit.targetPerDay ?? 1
                // Tick mode is binary: either the day is checked (full intensity) or not.
                const intensity = count === 0
                  ? 0
                  : isTickMode
                  ? 4
                  : count >= target * 4
                  ? 4
                  : count >= target * 2
                  ? 3
                  : count >= target
                  ? 2
                  : 1
                const opacity = intensity === 0 ? undefined : isTickMode ? 0.8 : 0.2 + (intensity * 0.2)
                const isFuture = dateStr > todayStr
                const isBeforeStart = dateStr < habitStartDate
                const isToday = dateStr === todayStr
                const isForgiven = forgivenDates.has(dateStr)
                const hasLogs = count > 0
                const isMissed = !hasLogs && !isFuture && !isBeforeStart && !isForgiven
                // Streak break: a past logged day followed by 2+ consecutive missed days
                // We need to check if the previous day had logs and this day is the start of a miss run of 2+
                let hasStreakBreak = false
                if (isMissed) {
                  // Check: previous day exists, had logs, and next day is also missed
                  const prevDay = new Date(day)
                  prevDay.setDate(prevDay.getDate() - 1)
                  const prevStr = format(prevDay, 'yyyy-MM-dd')
                  const prevHadLogs = (logsByDate[prevStr]?.length ?? 0) > 0
                  const nextDay = new Date(day)
                  nextDay.setDate(nextDay.getDate() + 1)
                  const nextStr = format(nextDay, 'yyyy-MM-dd')
                  const nextDayLogs = logsByDate[nextStr] ?? []
                  const nextIsMissed = nextDayLogs.length === 0 && nextStr <= todayStr && nextStr >= habitStartDate && !forgivenDates.has(nextStr)
                  if (prevHadLogs && nextIsMissed) hasStreakBreak = true
                }
                const muted = isFuture || isBeforeStart
                return (
                  <button
                    key={dateStr}
                    onClick={() => setDayDetailDate(dateStr)}
                    title={muted ? dateStr : isTickMode ? `${dateStr} — ${hasLogs ? '✓' : 'missed'}` : totalValue > 0 ? `${dateStr} — ${count} log${count !== 1 ? 's' : ''} (${totalValue} total)` : isForgiven ? `${dateStr} — forgiven` : isMissed ? `${dateStr} — missed` : `${dateStr}${count > 0 ? ` — ${count} log${count !== 1 ? 's' : ''}` : ''}`}
                    aria-label={muted ? dateStr : hasLogs ? `Logged` : isForgiven ? `Forgiven` : isMissed ? `Missed` : `No study logged`}
                    className={cn(
                      'flex h-9 w-full flex-col items-center justify-center rounded text-xs font-medium transition-all',
                      muted && 'cursor-default text-slate-300 dark:text-slate-600',
                      !muted && 'hover:ring-2 hover:ring-primary-400',
                      isToday && 'ring-2 ring-orange-400',
                      hasLogs && 'text-white shadow-sm',
                      isForgiven && 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
                      isMissed && !hasStreakBreak && 'bg-red-50 text-red-400 dark:bg-red-900/20 dark:text-red-400',
                      isMissed && hasStreakBreak && 'bg-red-50 text-red-400 dark:bg-red-900/20 dark:text-red-400 border-l-2 border-red-400',
                      !hasLogs && !isForgiven && !isMissed && !muted && 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    )}
                    style={hasLogs ? { backgroundColor: selectedHabit.color, opacity } : undefined}
                  >
                    <span>{format(day, 'd')}</span>
                    {isMissed && !muted && <span className="text-[9px] text-red-400">×</span>}
                    {isForgiven && <span className="text-[9px]">♡</span>}
                    {hasLogs && isTickMode && <span className="text-[9px] opacity-90">✓</span>}
                    {hasLogs && !isTickMode && <span className="text-[9px] opacity-90">×{count}{totalValue > 0 ? ` ${totalValue}` : ''}</span>}
                  </button>
                )
                })
              })()}
            </div>
            {/* Heatmap legend — 5 levels */}
            <div className="mt-2 flex items-center justify-end gap-1 text-xs text-slate-500">
              <span>less</span>
              <div className="h-3 w-3 rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-3 w-3 rounded" style={{ backgroundColor: selectedHabit.color, opacity: 0.2 }} />
              <div className="h-3 w-3 rounded" style={{ backgroundColor: selectedHabit.color, opacity: 0.4 }} />
              <div className="h-3 w-3 rounded" style={{ backgroundColor: selectedHabit.color, opacity: 0.6 }} />
              <div className="h-3 w-3 rounded" style={{ backgroundColor: selectedHabit.color, opacity: 0.8 }} />
              <div className="h-3 w-3 rounded" style={{ backgroundColor: selectedHabit.color, opacity: 1 }} />
              <span>more</span>
            </div>
          </div>
          <div className="mb-4">
            <Button variant="secondary" onClick={() => openAddLog()}>+ Add Log</Button>
          </div>
        </Card>
      )}


      <Modal open={showModal} onClose={() => setShowModal(false)} title={editHabit ? 'Edit Habit' : 'Add Habit'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {kind === 'bad' ? 'What are you quitting?' : 'Name'}
              </label>
              <input
                className="input"
                placeholder={kind === 'bad' ? 'Quitting smoking' : 'Name'}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {kind === 'bad' && (
                <p className="mt-1 text-xs text-slate-500">
                  Bad habits track days you DON'T do the thing. Logging = you did it.
                </p>
              )}
            </div>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Habit['kind'])}>
              <option value="good">Good</option>
              <option value="bad">Bad</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ColorPicker value={color} onChange={setColor} />
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Target per day</label>
              <input
                type="number"
                className="input"
                min={1}
                value={targetPerDay}
                onChange={(e) => setTargetPerDay(Number(e.target.value) || 1)}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Archive after (days, 0 = never)</label>
            <input
              type="number"
              className="input"
              min={0}
              placeholder={String(settings.defaultArchiveDays)}
              value={archivedAfterDays ?? ''}
              onChange={(e) => {
                const v = e.target.value
                setArchivedAfterDays(v === '' ? null : Number(v))
              }}
            />
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Tracking mode</label>
            <select
              className="input"
              value={habitMode}
              onChange={(e) => setHabitMode(e.target.value as Habit['mode'])}
            >
              <option value="count">Count — log every occurrence</option>
              <option value="tick">Tick once per day</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              {habitMode === 'tick' ? 'One log per day, with an uncheck option to remove it.' : 'Log each time the habit happens (e.g. glasses of water).'}
            </p>
          </div>
          </div>
          {!editHabit && (
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={parkForLater}
                onChange={(e) => setParkForLater(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              Park this for later (won't count toward your habit limit)
            </label>
          )}
          <Button variant="primary" className="w-full" onClick={saveHabit}>{editHabit ? 'Save' : 'Add'}</Button>
        </div>
      </Modal>

      <Modal open={showAddLog} onClose={() => { setShowAddLog(false); setEditLogCameFromDayDetail(false) }} title={editLog ? 'Edit Log' : 'Add Log'}>
        <div className="space-y-3">
          <input type="date" className="input" max={todayStr} value={logDate} onChange={(e) => setLogDate(e.target.value)} />
          <input type="time" className="input" value={logTime} onChange={(e) => setLogTime(e.target.value)} />
          <input
            type="number"
            className="input"
            placeholder="Amount (optional, e.g. 15 for 15 minutes)"
            min={0}
            value={logValue}
            onChange={(e) => setLogValue(e.target.value)}
          />
          <textarea className="input" placeholder="Note (e.g. what happened, how you felt)" rows={3} value={logNote} onChange={(e) => setLogNote(e.target.value)} />
          <Button variant="primary" className="w-full" onClick={saveLog}>Save</Button>
        </div>
      </Modal>

      <Modal open={dayDetailDate !== null} onClose={() => setDayDetailDate(null)} title={dayDetailDate ? format(parseISO(dayDetailDate), 'EEEE, MMM d, yyyy') : ''}>
        <div className="space-y-3">
          {dayDetailDate && logsByDate[dayDetailDate]?.length > 0 ? (
            logsByDate[dayDetailDate].map(log => (
              <div key={log.id} className="flex items-start justify-between gap-2 rounded bg-slate-50 p-2 text-sm dark:bg-slate-700">
                <div className="flex-1">
                  {log.time && <span className="mr-2 font-mono font-medium text-slate-600 dark:text-slate-300">{log.time}</span>}
                  {log.note ? <span className="text-slate-800 dark:text-slate-100">{log.note}</span> : <span className="text-slate-400 italic dark:text-slate-500">(no note)</span>}
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => { setEditLogCameFromDayDetail(true); openAddLog(log) }}
                    className="text-xs text-primary-600 hover:text-primary-800 dark:text-primary-400"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteLog(log)}
                    className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">No logs for this day.</p>
          )}
        </div>
      </Modal>

      <Modal open={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="Delete Habit?">
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This will delete the habit and all its logs. You can undo with Ctrl+Z.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onClick={() => deleteConfirm && deleteHabitFn(deleteConfirm)}>Delete</Button>
          </div>
        </div>
      </Modal>

      <Modal open={archiveConfirm !== null} onClose={() => setArchiveConfirm(null)} title="Pause Habit?">
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Pause this habit? It stops appearing in your active list but keeps all data. You can resume it later from the archived list.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setArchiveConfirm(null)}>Cancel</Button>
            <Button variant="primary" className="flex-1" onClick={() => archiveConfirm && archiveHabitFn(archiveConfirm)}>Pause</Button>
          </div>
        </div>
      </Modal>
      <Modal open={finishConfirm !== null} onClose={() => setFinishConfirm(null)} title="Mark Habit as Done?">
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Mark this habit as done? It moves to a separate &quot;Finished&quot; section, stops counting toward your habit limit, and stops showing reminders — but the data is preserved.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setFinishConfirm(null)}>Cancel</Button>
            <Button variant="primary" className="flex-1" onClick={() => finishConfirm && finishHabitFn(finishConfirm)}>Mark as Done</Button>
          </div>
        </div>
      </Modal>

      <Modal open={resetConfirm !== null} onClose={() => setResetConfirm(null)} title="Reset Habit Data?">
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This will clear all logs for this habit (streak resets to zero, history removed) but keeps the habit itself. The habit stays in your active list.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setResetConfirm(null)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onClick={() => resetConfirm && resetHabitDataFn(resetConfirm)}>Reset Data</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
