import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useData } from '../../app/providers'
import { db } from '../../db/app-db'
import { cn, gradeColor, isoNow, pctToGrade, sessionLocalDate, softDelete } from '../../lib/utils'
import { filterActive } from '../../lib/filterActive'
import { useUndo } from '../../lib/use-undo'
import { Button } from '../../components/ui/Button'
import { Card, CardHeader, CardTitle } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { PageSpinner } from '../../components/ui/Spinner'
import { v4 as uuid } from 'uuid'
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  addMonths,
  subMonths,
  isSameMonth,
  isToday,
  parseISO,
  addDays,
} from 'date-fns'
import type { Assignment, Project, Subject, TaskCategory } from '../../domain/types'

import { TASK_CATEGORIES } from '../../domain/types'

interface TaskForm {
  title: string
  subjectId: string
  projectId: string
  dueDate: string
  category: TaskCategory
  weight: string
  description: string
}
const emptyForm = (subjects: Subject[]): TaskForm => ({
  title: '',
  subjectId: subjects[0]?.id ?? '',
  projectId: '',
  dueDate: format(new Date(), 'yyyy-MM-dd'),
  category: 'homework',
  weight: '',
  description: '',
})

const toForm = (a: Assignment): TaskForm => ({
  title: a.title,
  subjectId: a.subjectId,
  projectId: a.projectId ?? '',
  dueDate: sessionLocalDate(a.dueDate),
  category: a.category,
  weight: a.weight > 0 ? String(a.weight) : '',
  description: a.description ?? '',
})

interface MarkForm {
  score: string
  total: string
}

const emptyMarkForm = (): MarkForm => ({ score: '', total: '100' })

export default function CalendarPage() {
  const { data, isLoading, loadData, mutate } = useData()
  const { push: pushUndo } = useUndo()
  const location = useLocation()
  const navigate = useNavigate()
  const [viewDate, setViewDate] = useState(() => new Date())
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    setIsMobile(mql.matches)
    function onChange(e: MediaQueryListEvent) { setIsMobile(e.matches) }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  const [modalOpen, setModalOpen] = useState(false)
  // M1 fix: FAB navigates here with { state: { openAdd: true } } — open the
  // add modal on mount and clear the flag.
  useEffect(() => {
    if (location.state?.openAdd) {
      setModalOpen(true)
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [editing, setEditing] = useState<Assignment | null>(null)
  const [form, setForm] = useState<TaskForm>(() => emptyForm(data.subjects))

  // Record mark modal
  const [markModalOpen, setMarkModalOpen] = useState(false)
  const [markingTask, setMarkingTask] = useState<Assignment | null>(null)
  const [markForm, setMarkForm] = useState<MarkForm>(emptyMarkForm)
  const [markSaving, setMarkSaving] = useState(false)
    const [toast, setToast] = useState<{ id: string; title: string } | null>(null)
    useEffect(() => {
      if (toast) {
        const t = setTimeout(() => setToast(null), 8000)
        return () => clearTimeout(t)
      }
    }, [toast])

  // Category filter
  const [filterCategory, setFilterCategory] = useState<TaskCategory | ''>('')

  // keep form subject default in sync when subjects load
  useEffect(() => {
    setForm((f) => (f.subjectId ? f : { ...f, subjectId: data.subjects[0]?.id ?? '' }))
  }, [data.subjects])

  const monthStart = startOfMonth(viewDate)
  const monthEnd = endOfMonth(viewDate)
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const padStart = getDay(monthStart) // 0 (Sun) - 6 (Sat)

  const activeTasks = useMemo(
    () => data.assignments.filter((a) => !a.deletedAt),
    [data.assignments]
  )

  const filteredTasks = useMemo(() => {
    if (!filterCategory) return activeTasks
    return activeTasks.filter((a) => a.category === filterCategory)
  }, [activeTasks, filterCategory])
  // Keyboard shortcuts
  const [selectedIndex, setSelectedIndex] = useState(0)

  // N — Add new task
  useEffect(() => {
    function onAdd() { setModalOpen(true) }
    window.addEventListener('momentum:calendar-add', onAdd)
    return () => window.removeEventListener('momentum:calendar-add', onAdd)
  }, [])

  // ← / → — Navigate month
  useEffect(() => {
    function onPrev() { setViewDate(d => subMonths(d, 1)) }
    function onNext() { setViewDate(d => addMonths(d, 1)) }
    function onToday() { setViewDate(new Date()) }
    window.addEventListener('momentum:calendar-prev-month', onPrev)
    window.addEventListener('momentum:calendar-next-month', onNext)
    window.addEventListener('momentum:calendar-today', onToday)
    return () => {
      window.removeEventListener('momentum:calendar-prev-month', onPrev)
      window.removeEventListener('momentum:calendar-next-month', onNext)
      window.removeEventListener('momentum:calendar-today', onToday)
    }
  }, [])

  // ↑ / ↓ — Navigate tasks
  useEffect(() => {
    function onPrev() { setSelectedIndex(i => Math.max(0, i - 1)) }
    function onNext() { setSelectedIndex(i => Math.min(filteredTasks.length - 1, i + 1)) }
    window.addEventListener('momentum:calendar-prev-task', onPrev)
    window.addEventListener('momentum:calendar-next-task', onNext)
    return () => {
      window.removeEventListener('momentum:calendar-prev-task', onPrev)
      window.removeEventListener('momentum:calendar-next-task', onNext)
    }
  }, [filteredTasks.length])

void selectedIndex // consumed by keyboard navigation event listeners for task selection

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Assignment[]>()
    for (const a of filteredTasks) {
      const key = sessionLocalDate(a.dueDate)
      const arr = map.get(key) ?? []
      arr.push(a)
      map.set(key, arr)
    }
    return map
  }, [filteredTasks])
  const activeProjects = useMemo(
    () => data.projects.filter((p) => !p.deletedAt && p.dueDate),
    [data.projects]
  )
  const projectsByDate = useMemo(() => {
    const map = new Map<string, Project[]>()
    for (const p of activeProjects) {
      const key = sessionLocalDate(p.dueDate!)
      const arr = map.get(key) ?? []
      arr.push(p)
      map.set(key, arr)
    }
    return map
  }, [activeProjects])

  const timeSpentByProject = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of data.sessions) {
      if (s.projectId) {
        map.set(s.projectId, (map.get(s.projectId) ?? 0) + s.durationMinutes)
      }
    }
    return map
  }, [data.sessions])

  const weeksGrid = useMemo(() => {
    const weeks: { date: Date | null }[][] = []
    let week: { date: Date | null }[] = []
    // leading empty cells
    for (let i = 0; i < padStart; i++) week.push({ date: null })
    for (const day of monthDays) {
      week.push({ date: day })
      if (week.length === 7) {
        weeks.push(week)
        week = []
      }
    }
    // trailing empty cells
    if (week.length > 0) {
      while (week.length < 7) week.push({ date: null })
      weeks.push(week)
    }
    return weeks
  }, [monthDays, padStart])

  if (isLoading) return <PageSpinner />


  function prevMonth() {
    setViewDate((d) => subMonths(d, 1))
  }
  function nextMonth() {
    setViewDate((d) => addMonths(d, 1))
  }
  function goToday() {
    setViewDate(new Date())
  }

  function openAddModal() {
    setEditing(null)
    setForm(emptyForm(data.subjects))
    setModalOpen(true)
  }

  function openEditModal(a: Assignment) {
    setEditing(a)
    setForm(toForm(a))
    setModalOpen(true)
  }

  async function saveTask() {
    const title = form.title.trim()
    const subjectId = form.subjectId
    const projectId = form.projectId || null
    const dueDate = form.dueDate
    const category = form.category
    const weight = Number(form.weight) || 0
    const description = form.description.trim()
    if (!title || !subjectId || !dueDate) return
    const now = isoNow()
    if (editing) {
      await db.assignments.update(editing.id, {
        title,
        subjectId,
        projectId,
        dueDate,
        category,
        weight,
        description: description || undefined,
        updatedAt: now,
      })
      mutate(prev => ({ ...prev, assignments: prev.assignments.map(a => a.id === editing.id ? { ...a, title, subjectId, projectId, dueDate, category, weight, description: description || undefined, updatedAt: now } : a) }))
    } else {
      const newAssignment = {
        id: uuid(),
        title,
        subjectId,
        projectId,
        dueDate,
        category,
        weight,
        description: description || undefined,
        completed: false,
        createdAt: now,
        updatedAt: now,
      }
      await db.assignments.add(newAssignment)
      mutate(prev => ({ ...prev, assignments: [...prev.assignments, newAssignment] }))
    }
    setModalOpen(false)
  }
  async function deleteTask(id: string) {
    const a = await softDelete(db.assignments, id)
    if (!a) return
    mutate(prev => ({ ...prev, assignments: prev.assignments.map(x => x.id === id ? { ...x, deletedAt: a.deletedAt, updatedAt: a.updatedAt } : x) }))
    pushUndo({
      description: `Deleted task "${a.title}"`,
      undo: async () => {
        await db.assignments.put({ ...a, deletedAt: null, updatedAt: isoNow() })
        mutate(prev => ({ ...prev, assignments: prev.assignments.map(x => x.id === id ? { ...x, deletedAt: null, updatedAt: isoNow() } : x) }))
      },
      redo: async () => {
        await db.assignments.put({ ...a, deletedAt: a.deletedAt, updatedAt: isoNow() })
        mutate(prev => ({ ...prev, assignments: prev.assignments.map(x => x.id === id ? { ...x, deletedAt: a.deletedAt, updatedAt: isoNow() } : x) }))
      },
    })
  }
  function openMarkModal(a: Assignment) {
    setMarkingTask(a)
    setMarkForm(emptyMarkForm())
    setMarkModalOpen(true)
  }

  async function saveMarkAndComplete() {
    if (!markingTask) return
    const score = Number(markForm.score)
    const total = Number(markForm.total) || 100
    if (isNaN(score) || isNaN(total) || total <= 0) return

    setMarkSaving(true)
    const now = isoNow()
    const newMark = {
      id: uuid(),
      subjectId: markingTask.subjectId,
      name: markingTask.title,
      score,
      total,
      weight: markingTask.weight,
      letterGrade: null,
      date: sessionLocalDate(now),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    await db.marks.add(newMark)
    await db.assignments.update(markingTask.id, { completed: true, updatedAt: now })
    mutate(prev => ({ ...prev, marks: [...prev.marks, newMark], assignments: prev.assignments.map(a => a.id === markingTask.id ? { ...a, completed: true, updatedAt: now } : a) }))
    setMarkModalOpen(false)
    setMarkingTask(null)
    setMarkSaving(false)
  }
    async function quickCompleteTask(a: Assignment) {
      if (!a.completed && a.weight > 0) {
        await db.assignments.put({ ...a, completed: true, updatedAt: isoNow() })
        setToast({ id: a.id, title: a.title })
        mutate(prev => ({ ...prev, assignments: prev.assignments.map(x => x.id === a.id ? { ...x, completed: true, updatedAt: isoNow() } : x) }))
      } else {
        await db.assignments.put({ ...a, completed: !a.completed, updatedAt: isoNow() })
        mutate(prev => ({ ...prev, assignments: prev.assignments.map(x => x.id === a.id ? { ...x, completed: !a.completed, updatedAt: isoNow() } : x) }))
      }
    }

  // upcoming tasks next 30 days
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const in30 = addDays(new Date(), 30)
  const upcoming = filteredTasks
      .filter((a) => {
        if (!a.dueDate) return false
        const d = parseISO(a.dueDate)
        return d >= new Date(todayStr) && d <= in30
      })
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
  
    const overdueTasks = filteredTasks
      .filter((a) => {
        if (!a.dueDate || a.completed) return false
        return sessionLocalDate(a.dueDate) < todayStr
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  
    async function completeAllOverdue() {
      if (overdueTasks.length === 0) return
      const now = isoNow()
      for (const t of overdueTasks) {
        await db.assignments.put({ ...t, completed: true, updatedAt: now })
      }
      await loadData()
    }

  // Completed tasks
  const completedTasks = useMemo(
    () => activeTasks.filter((a) => a.completed).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    [activeTasks]
  )
  const [completedOpen, setCompletedOpen] = useState(false)

  const taskValid =
    form.title.trim() !== '' &&
    form.subjectId !== '' &&
    form.dueDate !== ''

  const markValid =
    !isNaN(Number(markForm.score)) &&
    !isNaN(Number(markForm.total)) &&
    Number(markForm.total) > 0

  const catColor = (cat: TaskCategory) =>
    TASK_CATEGORIES.find((c) => c.value === cat)?.color ?? '#64748b'
  // Time spent per project (sum of session minutes)

  return (
    <>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Tasks</h2>
        <div className="flex items-center gap-2">
          <Button onClick={prevMonth} size="sm" variant="secondary">‹</Button>
          <Button onClick={goToday} size="sm" variant="secondary">Today</Button>
          <Button onClick={nextMonth} size="sm" variant="secondary">›</Button>
          <Button onClick={openAddModal} size="sm">Add Task</Button>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterCategory('')}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
            filterCategory === ''
              ? 'bg-slate-700 text-white dark:bg-slate-300 dark:text-slate-900'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
          )}
        >
          All
        </button>
        {TASK_CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setFilterCategory(cat.value)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filterCategory === cat.value
                ? 'text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
            )}
            style={filterCategory === cat.value ? { backgroundColor: cat.color } : {}}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Monthly calendar — list view on mobile, grid on desktop */}
      {isMobile ? (
        <Card>
          <CardHeader>
            <CardTitle>{format(monthStart, 'MMMM yyyy')}</CardTitle>
          </CardHeader>
          {monthDays.every((d) => (tasksByDate.get(format(d, 'yyyy-MM-dd')) ?? []).length === 0 && (projectsByDate.get(format(d, 'yyyy-MM-dd')) ?? []).length === 0) ? (
            <EmptyState title="No tasks this month" description="Your calendar is clear." />
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-700">
              {monthDays
                .filter((d) => {
                  const key = format(d, 'yyyy-MM-dd')
                  return (tasksByDate.get(key) ?? []).length > 0 || (projectsByDate.get(key) ?? []).length > 0
                })
                .map((d) => {
                  const key = format(d, 'yyyy-MM-dd')
                  const items = tasksByDate.get(key) ?? []
                  const projects = projectsByDate.get(key) ?? []
                  const today = isToday(d)
                  return (
                    <li key={key} className="py-3" aria-label={format(d, 'EEEE, MMMM d, yyyy')}>
                      <div className={cn('mb-2 flex items-center gap-2 text-sm font-medium', today ? 'text-primary-600' : 'text-slate-700 dark:text-slate-100')}>
                        <span>{format(d, 'EEE, MMM d')}</span>
                        {today && <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">Today</span>}
                      </div>
                      <ul className="space-y-1.5">
                        {items.map((it) => (
                          <li key={it.id} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={it.completed}
                              onChange={() => void quickCompleteTask(it)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-3.5 w-3.5 flex-shrink-0 cursor-pointer"
                            />
                            <button
                              onClick={() => openEditModal(it)}
                              className="flex flex-1 items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                              <span
                                className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                                style={{ backgroundColor: catColor(it.category) }}
                                aria-hidden="true"
                              />
                              <span className={cn('flex-1 text-sm', it.completed ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-100')}>
                                {it.title}
                              </span>
                            </button>
                          </li>
                        ))}
                        {projects.map((p) => (
                          <li key={p.id} className="flex items-center gap-2 rounded bg-amber-100 px-2 py-1 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                            <span aria-hidden="true">🎯</span>
                            <span className="text-sm font-medium">{p.name}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  )
                })}
            </ul>
          )}
        </Card>
      ) : (
      <Card>
        <CardHeader>
          <CardTitle>{format(monthStart, 'MMMM yyyy')}</CardTitle>
        </CardHeader>

        <div className="grid grid-cols-7 gap-1 text-sm">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="py-1 text-center font-medium text-slate-600 dark:text-slate-300">{d}</div>
          ))}

          {weeksGrid.map((week, wi) => (
            <div key={wi} className="contents">
              {week.map((cell, ci) => {
                if (!cell.date) {
                  return <div key={ci} className="min-h-[80px] border p-2 bg-slate-50 dark:bg-slate-900" />
                }
                const date = cell.date
                const key = format(date, 'yyyy-MM-dd')
                const items = tasksByDate.get(key) ?? []
                const projects = projectsByDate.get(key) ?? []
                const muted = !isSameMonth(date, monthStart)
                const today = isToday(date)
                return (
                  <div
                    key={ci}
                    data-today={today || undefined}
                    aria-label={`${format(date, 'EEEE, MMMM d, yyyy')}`}
                    className={cn(
                      'min-h-[80px] border p-2 flex flex-col justify-between',
                      muted ? 'bg-slate-50 text-slate-400 dark:bg-slate-900 dark:text-slate-500' : 'bg-white dark:bg-slate-800'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className={cn('text-sm font-medium', today ? 'text-primary-600' : 'text-slate-700 dark:text-slate-100')}>
                        {format(date, 'd')}
                      </div>
                      {today && <div className="text-xs text-primary-600">Today</div>}
                    </div>

                    <div className="mt-2 flex-1 flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {items.slice(0, 4).map((it) => (
                          <div key={it.id} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={it.completed}
                              onChange={() => void quickCompleteTask(it)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-3 w-3 flex-shrink-0 cursor-pointer"
                            />
                            <button
                              onClick={() => openEditModal(it)}
                              title={it.title}
                              className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                              <span
                                className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: catColor(it.category) }}
                                aria-hidden="true"
                              />
                              <span className={cn('text-xs', it.completed ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-100')}>
                                {it.title}
                              </span>
                            </button>
                          </div>
                        ))}
                        {items.length > 4 && <div className="text-xs text-slate-400">+{items.length - 4}</div>}
                      </div>
                      {projects.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          {projects.slice(0, 2).map((p) => (
                            <span
                              key={p.id}
                              title={`Project deadline: ${p.name}`}
                              className="flex items-center gap-1 rounded px-1 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                            >
                              <span className="text-xs">🎯</span>
                              <span className="text-xs font-medium truncate max-w-[100px]">
                                {p.name}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </Card>
      )}

      {/* Overdue tasks */}
      {overdueTasks.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Overdue ({overdueTasks.length})</CardTitle>
              <Button variant="secondary" size="sm" onClick={() => void completeAllOverdue()}>
                Mark all done
              </Button>
            </div>
          </CardHeader>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {overdueTasks.map((a) => {
              const subject = data.subjects.find((s) => s.id === a.subjectId)
              const daysOverdue = Math.floor(
                (Date.now() - new Date(a.dueDate).getTime()) / (1000 * 60 * 60 * 24)
              )
              return (
                <li key={a.id} className="flex items-center justify-between gap-4 py-3 px-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={a.completed}
                      onChange={() => void quickCompleteTask(a)}
                      className="mt-1 h-4 w-4 cursor-pointer"
                    />
                    <div>
                      <div className="font-medium text-slate-800 dark:text-slate-100">{a.title}</div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span>{subject?.name ?? 'No focus area'}</span>
                        <span>•</span>
                        <span className="text-red-600 font-medium">Overdue {daysOverdue}d</span>
                        {a.weight > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-slate-400">{a.weight}%</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                      style={{ backgroundColor: catColor(a.category) }}
                    >
                      {TASK_CATEGORIES.find((c) => c.value === a.category)?.label}
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => openEditModal(a)}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => void deleteTask(a.id)}>Delete</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {/* Upcoming tasks */}
      <Card>
        <CardHeader>
          <CardTitle>Upcoming (30 days)</CardTitle>
        </CardHeader>

        {upcoming.length === 0 ? (
          <EmptyState title="No upcoming tasks" description="You're all clear for the next 30 days." />
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {upcoming.map((a) => {
              const subject = data.subjects.find((s) => s.id === a.subjectId)
              const project = a.projectId ? data.projects.find((p) => p.id === a.projectId) : null
              const projectMinutes = a.projectId ? (timeSpentByProject.get(a.projectId) ?? 0) : 0
              return (
                <li key={a.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={a.completed}
                      onChange={() => void quickCompleteTask(a)}
                      className="mt-1 h-4 w-4"
                    />
                    <div>
                      <div className={cn('font-medium', a.completed ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-100')}>
                        {a.title}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span>{subject ? subject.name : 'No focus area'}</span>
                        {a.projectId && (
                          <>
                            <span>•</span>
                            <span className="text-primary-600 dark:text-primary-400">
                              {data.projects.find((p) => p.id === a.projectId)?.name ?? 'Unknown project'}
                            </span>
                          </>
                        )}
                        <span>•</span>
                        <span>{a.dueDate ? format(parseISO(a.dueDate), 'MMM d, yyyy') : 'No date'}</span>
                        {a.weight > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-slate-400">{a.weight}%</span>
                          </>
                        )}
                      </div>
                      {project && projectMinutes > 0 && (
                        <div className="mt-1 text-xs text-slate-500">
                          {Math.floor(projectMinutes / 60)}h {projectMinutes % 60}m spent
                          {project.goalMinutes && project.goalMinutes > 0 && (
                            <span> of {Math.floor(project.goalMinutes / 60)}h {project.goalMinutes % 60}m goal</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                      style={{ backgroundColor: catColor(a.category) }}
                    >
                      {TASK_CATEGORIES.find((c) => c.value === a.category)?.label}
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => openEditModal(a)}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => void deleteTask(a.id)}>Delete</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Completed tasks */}
      {completedTasks.length > 0 && (
        <Card>
          <CardHeader>
            <button
              type="button"
              onClick={() => setCompletedOpen(!completedOpen)}
              className="flex w-full items-center justify-between text-left"
            >
              <CardTitle>Completed ({completedTasks.length})</CardTitle>
              <span className={cn('text-slate-500 transition-transform', completedOpen && 'rotate-90')}>
                ▶
              </span>
            </button>
          </CardHeader>
          {completedOpen && (
            <ul className="divide-y divide-slate-200 dark:divide-slate-700">
              {completedTasks.map((a) => {
                const subject = data.subjects.find((s) => s.id === a.subjectId)
                return (
                  <li key={a.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={true}
                        onChange={() => void quickCompleteTask(a)}
                        className="mt-1 h-4 w-4 cursor-pointer"
                      />
                      <div>
                        <div className="font-medium text-slate-400 line-through dark:text-slate-500">
                          {a.title}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span>{subject?.name ?? 'No focus area'}</span>
                          <span>·</span>
                          <span>Completed {format(parseISO(a.updatedAt), 'MMM d')}</span>
                          {a.dueDate && (
                            <>
                              <span>·</span>
                              <span>Due {format(parseISO(a.dueDate), 'MMM d')}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => void quickCompleteTask(a)}>
                      Reopen
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      )}

      {/* Add / Edit Task modal */}
      <Modal title={editing ? 'Edit Task' : 'Add Task'} open={modalOpen} onClose={() => setModalOpen(false)}>
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="task-title">Title</label>
            <input
              id="task-title"
              className="input w-full"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Chapter 5 homework"
            />
          </div>

          <div>
            <label className="label" htmlFor="task-subject">Focus Area</label>
            <select
              id="task-subject"
              className="input w-full"
              value={form.subjectId}
              onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value }))}
            >
              <option value="">Select subject</option>
              {filterActive(data.subjects).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="task-project">Project (optional)</label>
            <select
              id="task-project"
              className="input w-full"
              value={form.projectId}
              onChange={(e) => {
                const pId = e.target.value
                setForm((f) => {
                  const project = data.projects.find((p) => p.id === pId)
                  return {
                    ...f,
                    projectId: pId,
                    subjectId: project ? project.subjectId : f.subjectId
                  }
                })
              }}
            >
              <option value="">Select project</option>
              {data.projects.filter((p) => !p.deletedAt).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="task-due">Due date</label>
              <input
                id="task-due"
                type="date"
                className="input w-full"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="task-cat">Category</label>
              <select
                id="task-cat"
                className="input w-full"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as TaskCategory }))}
              >
                {TASK_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="task-weight">Weight (%): grade contribution (0 = not graded)</label>
            <input
              id="task-weight"
              type="number"
              min="0"
              max="100"
              className="input w-full"
              value={form.weight}
              onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
              placeholder="0"
            />
          </div>

          <div>
            <label className="label" htmlFor="task-desc">Description (optional)</label>
            <textarea
              id="task-desc"
              className="input w-full"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void saveTask()} disabled={!taskValid}>
              {editing ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Record Mark modal — shown when completing a graded task */}
      <Modal
        title={`Record mark: ${markingTask?.title ?? ''}`}
        open={markModalOpen}
        onClose={() => { setMarkModalOpen(false); setMarkingTask(null) }}
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            This task is worth <strong>{markingTask?.weight}%</strong> of your grade.
            Enter the result to record your mark.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="mark-score">Score</label>
              <input
                id="mark-score"
                type="number"
                className="input w-full"
                value={markForm.score}
                onChange={(e) => setMarkForm((f) => ({ ...f, score: e.target.value }))}
                placeholder="85"
              />
            </div>
            <div>
              <label className="label" htmlFor="mark-total">Total</label>
              <input
                id="mark-total"
                type="number"
                className="input w-full"
                value={markForm.total}
                onChange={(e) => setMarkForm((f) => ({ ...f, total: e.target.value }))}
                placeholder="100"
              />
            </div>
          </div>
          {markValid && (
            <div className="text-sm text-slate-500">
              Result: <strong>{((Number(markForm.score) / Number(markForm.total)) * 100).toFixed(1)}%</strong>{' '}
              <span className={cn(gradeColor(pctToGrade((Number(markForm.score) / Number(markForm.total)) * 100)))}>
                {pctToGrade((Number(markForm.score) / Number(markForm.total)) * 100)}
              </span>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => { setMarkModalOpen(false); setMarkingTask(null) }}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveMarkAndComplete()} disabled={!markValid || markSaving}>
              {markSaving ? 'Saving...' : 'Record & Complete'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 transform">
          <div className="flex items-center gap-3 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
            <span>{toast.title} marked complete!</span>
            <button
              onClick={() => {
                const t = activeTasks.find(a => a.id === toast.id)
                if (t) openMarkModal(t)
                setToast(null)
              }}
              className="rounded bg-white/20 px-2 py-1 font-medium hover:bg-white/30 dark:bg-slate-900/20 dark:hover:bg-slate-900/30"
            >
              Record mark
            </button>
            <button
              onClick={() => setToast(null)}
              className="text-white/70 hover:text-white dark:text-slate-900/70 dark:hover:text-slate-900"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  )
}
