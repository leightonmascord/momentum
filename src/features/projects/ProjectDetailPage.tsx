import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { v4 as uuid } from 'uuid'
import { useData } from '../../app/providers'
import { db } from '../../db/app-db'
import { cn, formatMinutes, isoNow, sessionLocalDate, softDelete } from '../../lib/utils'
import { sessionIdFor } from '../../lib/timer-persistence'
import { useUndo } from '../../lib/use-undo'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageSpinner } from '../../components/ui/Spinner'
import type { Assignment, Session } from '../../domain/types'

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading, loadData } = useData()
  const { push: pushUndo } = useUndo()
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [showTimeModal, setShowTimeModal] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDue, setTaskDue] = useState('')
  const [editTask, setEditTask] = useState<Assignment | null>(null)
  const [timeMinutes, setTimeMinutes] = useState(30)
  const [timeNote, setTimeNote] = useState('')
  const [timeTaskId, setTimeTaskId] = useState<string>('')
  const [sortMode, setSortMode] = useState<'manual' | 'alpha' | 'due'>('manual')
  const [showCompleteModal, setShowCompleteModal] = useState(false)

  const project = useMemo(() => data.projects.find((p) => p.id === id), [data.projects, id])
  const subject = useMemo(() => data.subjects.find((s) => s.id === project?.subjectId), [data.subjects, project])
  const tasks = useMemo(
    () => data.assignments.filter((a) => a.projectId === id && !a.deletedAt),
    [data.assignments, id]
  )
  const sessions = useMemo(
    () => data.sessions.filter((s) => s.projectId === id).sort((a, b) => b.startAt.localeCompare(a.startAt)),
    [data.sessions, id]
  )
  const totalMinutes = useMemo(
    () => sessions.reduce((sum, s) => sum + s.durationMinutes, 0),
    [sessions]
  )
  const openTasks = useMemo(() => {
    const filtered = [...tasks.filter((t) => !t.completed)]
    if (sortMode === 'alpha') filtered.sort((a, b) => a.title.localeCompare(b.title))
    else if (sortMode === 'due') filtered.sort((a, b) => {
      const aDate = a.dueDate || '9999-12-31'
      const bDate = b.dueDate || '9999-12-31'
      return aDate.localeCompare(bDate)
    })
    else filtered.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
    return filtered
  }, [tasks, sortMode])
  const doneTasks = useMemo(() => [...tasks.filter((t) => t.completed)].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)), [tasks])

  if (isLoading) return <PageSpinner />
  if (!project) return <div className="space-y-4"><p className="text-red-600 dark:text-red-400">Project not found.</p><Link to="/projects" className="text-primary-500 underline">Back to projects</Link></div>

  const p = project
  async function saveTask() {
    if (!taskTitle.trim() || !p) return
    const now = isoNow()
    const finalDueDate = taskDue || ''
    if (editTask) {
      const prev = { ...editTask }
      await db.assignments.update(editTask.id, {
        title: taskTitle.trim(),
        dueDate: finalDueDate,
        updatedAt: now,
      })
      await loadData()
      pushUndo({ description: `Edited task "${taskTitle.trim()}"`, undo: async () => { await db.assignments.update(editTask.id, prev); await loadData() }, redo: async () => { await db.assignments.update(editTask.id, { title: taskTitle.trim(), dueDate: finalDueDate, updatedAt: now }); await loadData() } })
    } else {
      const maxIndex = tasks.reduce((max, t) => Math.max(max, t.orderIndex ?? 0), -1)
      const a: Assignment = {
        id: uuid(),
        subjectId: p.subjectId,
        projectId: p.id,
        title: taskTitle.trim(),
        dueDate: finalDueDate,
        category: 'homework',
        weight: 0,
        completed: false,
        orderIndex: maxIndex + 1,
        createdAt: now,
        updatedAt: now,
      }
      await db.assignments.add(a)
      await loadData()
      pushUndo({ description: `Added task "${a.title}" to ${p.name}`, undo: async () => { await db.assignments.delete(a.id); await loadData() }, redo: async () => { await db.assignments.add(a); await loadData() } })
    }
    setShowTaskModal(false)
    setEditTask(null)
    setTaskTitle('')
    setTaskDue('')
  }

  function openEditTask(task: Assignment) {
    setTaskDue(sessionLocalDate(task.dueDate))
    setEditTask(task)
    setTaskTitle(task.title)
    setShowTaskModal(true)
  }

  async function toggleTask(task: Assignment) {
    const updated = !task.completed
    await db.assignments.update(task.id, { completed: updated, updatedAt: isoNow() })
    await loadData()
    pushUndo({ description: `${updated ? 'Completed' : 'Reopened'} task "${task.title}"`, undo: async () => { await db.assignments.update(task.id, { completed: !updated, updatedAt: isoNow() }); await loadData() }, redo: async () => { await db.assignments.update(task.id, { completed: updated, updatedAt: isoNow() }); await loadData() } })
  }

  async function deleteTask(task: Assignment) {
    const deleted = await softDelete(db.assignments, task.id)
    if (!deleted) return
    await loadData()
    pushUndo({ description: `Deleted task "${task.title}"`, undo: async () => { await db.assignments.put({ ...task, deletedAt: null, updatedAt: isoNow() }); await loadData() }, redo: async () => { await db.assignments.put({ ...task, deletedAt: deleted.deletedAt, updatedAt: isoNow() }); await loadData() } })
  }

  async function moveTask(task: Assignment, direction: 1 | -1) {
    const sorted = [...openTasks]
    const idx = sorted.findIndex((t) => t.id === task.id)
    const target = idx + direction
    if (target < 0 || target >= sorted.length) return
    const other = sorted[target]
    const tempIndex = task.orderIndex ?? idx
    await db.assignments.update(task.id, { orderIndex: other.orderIndex ?? target, updatedAt: isoNow() })
    await db.assignments.update(other.id, { orderIndex: tempIndex, updatedAt: isoNow() })
    await loadData()
  }

  async function logTime() {
    if (!p) return
    const timeTask = timeTaskId ? tasks.find((t) => t.id === timeTaskId) : undefined
    const now = new Date()
    const start = new Date(now.getTime() - timeMinutes * 60_000)
    const startAt = start.toISOString()
    const session: Session = {
      id: sessionIdFor(startAt, p.subjectId, timeMinutes),
      subjectId: p.subjectId,
      projectId: p.id,
      assignmentId: timeTask?.id ?? null,
      startAt,
      endAt: now.toISOString(),
      durationMinutes: timeMinutes,
      note: timeNote.trim() || (timeTask ? `Task: ${timeTask.title}` : undefined),
      source: 'manual',
      createdAt: isoNow(),
      updatedAt: isoNow(),
    }
    await db.sessions.put(session)
    await loadData()
    pushUndo({
      description: `Logged ${timeMinutes}m for ${p.name}${timeTask ? ` (${timeTask.title})` : ''}`,
      undo: async () => {
        await db.sessions.update(session.id, { deletedAt: isoNow(), updatedAt: isoNow() })
        await loadData()
      },
      redo: async () => {
        await db.sessions.update(session.id, { deletedAt: null, updatedAt: isoNow() })
        await loadData()
      },
    })
    setShowTimeModal(false)
    setTimeMinutes(30)
    setTimeNote('')
    setTimeTaskId('')
  }

  async function handleToggleComplete() {
    if (!project) return
    const now = isoNow()
    const next = !project.completed
    await db.projects.update(project.id, {
      completed: next,
      completedAt: next ? now : null,
      updatedAt: now,
    })
    await loadData()
    pushUndo({
      description: next ? `Completed project "${project.name}"` : `Reopened project "${project.name}"`,
      undo: async () => {
        await db.projects.update(project.id, {
          completed: !next,
          completedAt: !next ? now : null,
          updatedAt: isoNow(),
        })
        await loadData()
      },
      redo: async () => {
        await db.projects.update(project.id, {
          completed: next,
          completedAt: next ? now : null,
          updatedAt: isoNow(),
        })
        await loadData()
      },
    })
    setShowCompleteModal(false)
  }

  const goalTarget = project.dailyTargetMinutes ?? project.weeklyTargetMinutes ?? project.totalTargetMinutes ?? 0
  const goalPct = goalTarget > 0 ? Math.min(100, Math.round((totalMinutes / goalTarget) * 100)) : 0
  const goalLabel = project.dailyTargetMinutes ? 'daily' : project.weeklyTargetMinutes ? 'weekly' : 'total'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/projects" className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400">← Back to projects</Link>
          <h2 className="mt-1 text-xl font-semibold text-slate-800 dark:text-slate-100">{project.name}</h2>
          {subject && <p className="text-sm text-slate-500">{subject.name}</p>}
          {project.description && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{project.description}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => { setEditTask(null); setTaskTitle(''); setTaskDue(''); setShowTaskModal(true) }}>+ Task</Button>
          <Button variant="primary" size="sm" onClick={() => setShowTimeModal(true)}>Log Time</Button>
          <Button
            variant={project.completed ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => setShowCompleteModal(true)}
          >
            {project.completed ? 'Reopen' : 'Mark Complete'}
          </Button>
        </div>
      </div>
      {project.completed && (
        <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-green-700 dark:text-green-300">
              ✓ Completed{project.completedAt ? ` on ${format(parseISO(project.completedAt), 'd MMM yyyy')}` : ''}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setShowCompleteModal(true)}>Reopen</Button>
          </div>
        </Card>
      )}
      {goalTarget > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Progress: {formatMinutes(totalMinutes)} / {formatMinutes(goalTarget)} · {goalLabel} goal
            </span>
            <span className="text-lg font-bold text-primary-600 dark:text-primary-400">{goalPct}%</span>
          </div>
          <div className="mt-2 h-3 w-full rounded-full bg-slate-200 dark:bg-slate-700">
            <div className={cn('h-3 rounded-full transition-all', goalPct >= 100 ? 'bg-green-500' : 'bg-primary-500')} style={{ width: `${goalPct}%` }} />
          </div>
        </Card>
      )}

      {/* Tasks */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Tasks ({tasks.length})</h3>
          <div className="flex gap-1 text-xs">
            {(['manual', 'alpha', 'due'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortMode(s)}
                className={cn(
                  'rounded px-2 py-0.5 font-medium transition-colors',
                  sortMode === s
                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                )}
              >
                {s === 'manual' ? 'Manual' : s === 'alpha' ? 'A-Z' : 'Due'}
              </button>
            ))}
          </div>
        </div>
        {tasks.length === 0 ? <EmptyState title="No tasks yet" description="Add tasks to break this project into smaller pieces." /> : (
          openTasks.map((t, idx) => (
          <div key={t.id} className="flex items-center justify-between border-b border-slate-100 py-2 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={false} onChange={() => toggleTask(t)} className="h-4 w-4 cursor-pointer" />
              <span className="text-sm text-slate-800 dark:text-slate-100">{t.title}</span>
              <span className="text-xs text-slate-400">{t.dueDate ? format(parseISO(t.dueDate), 'd MMM') : 'No due date'}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                {formatMinutes(sessions.filter((s) => s.assignmentId === t.id).reduce((sum, s) => sum + s.durationMinutes, 0))}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div className="flex flex-col">
                <button onClick={() => moveTask(t, -1)} disabled={idx === 0 || sortMode !== 'manual'} className="rounded p-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-slate-700" title="Move up">▲</button>
                <button onClick={() => moveTask(t, 1)} disabled={idx === openTasks.length - 1 || sortMode !== 'manual'} className="rounded p-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-slate-700" title="Move down">▼</button>
              </div>
              <Button variant="secondary" size="sm" onClick={() => { setTimeTaskId(t.id); setShowTimeModal(true) }}>+ Log</Button>
              <Button variant="secondary" size="sm" onClick={() => openEditTask(t)}>Edit</Button>
              <Button variant="danger" size="sm" onClick={() => deleteTask(t)}>×</Button>
            </div>
          </div>
          ))
        )}
        {doneTasks.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">{doneTasks.length} completed</summary>
            {doneTasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={true} onChange={() => toggleTask(t)} className="h-4 w-4 cursor-pointer" />
                  <span className="text-sm text-slate-500 line-through">{t.title}</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="secondary" size="sm" onClick={() => openEditTask(t)}>Edit</Button>
                  <Button variant="danger" size="sm" onClick={() => deleteTask(t)}>×</Button>
                </div>
              </div>
            ))}
          </details>
        )}
      </div>

      {/* Time Log */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Time Log ({formatMinutes(totalMinutes)})</h3>
        {sessions.length === 0 && <EmptyState title="No time logged yet" description="Use the Log Time button to track work on this project." />}
        <div className="space-y-2">
          {sessions.slice(0, 20).map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
              <div>
                <span className="text-slate-600 dark:text-slate-300">{format(parseISO(s.startAt), 'MMM d, h:mm a')}</span>
                {s.assignmentId && (
                  <span className="ml-2 rounded bg-primary-100 px-1.5 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/50 dark:text-primary-300">
                    {tasks.find((t) => t.id === s.assignmentId)?.title}
                  </span>
                )}
                {s.note && <span className="ml-2 text-slate-500">. {s.note}</span>}
              </div>
              <span className="font-medium text-slate-800 dark:text-slate-100">{formatMinutes(s.durationMinutes)}</span>
            </div>
          ))}
        </div>
      </div>

      <Modal open={showTaskModal} onClose={() => setShowTaskModal(false)} title={editTask ? 'Edit Task' : 'Add Task'}>
        <div className="space-y-3">
          <input className="input" placeholder="Task name" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
          <div className="flex items-center gap-2">
            <input type="date" className="input flex-1" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
            <Button type="button" variant="secondary" onClick={() => setTaskDue('')} disabled={!taskDue}>Clear</Button>
          </div>
          <Button variant="primary" className="w-full" onClick={saveTask}>{editTask ? 'Save Changes' : 'Add Task'}</Button>
        </div>
      </Modal>

      <Modal open={showTimeModal} onClose={() => { setShowTimeModal(false); setTimeTaskId('') }} title="Log Time">
        <div className="space-y-3">
          <div>
            <label className="label">Task (optional)</label>
            <select className="input" value={timeTaskId} onChange={(e) => setTimeTaskId(e.target.value)}>
              <option value="">No task</option>
              {tasks.filter((t) => !t.completed).map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Minutes</label>
            <input type="text" inputMode="numeric" pattern="[0-9]*" className="input" value={timeMinutes === 0 ? '' : String(timeMinutes)} onChange={(e) => { const v = e.target.value; if (v === '') { setTimeMinutes(0); return }; const n = Number(v); if (isNaN(n)) return; setTimeMinutes(Math.max(1, n)) }} />
          </div>
          <div>
            <label className="label">Note</label>
            <input className="input" placeholder="What did you work on?" value={timeNote} onChange={(e) => setTimeNote(e.target.value)} />
          </div>
          <Button variant="primary" className="w-full" onClick={logTime}>Log Time</Button>
        </div>
      </Modal>

      <Modal open={showCompleteModal} onClose={() => setShowCompleteModal(false)} title={project.completed ? 'Reopen Project' : 'Complete Project'}>
        <div className="space-y-4">
          <p className="text-slate-600 dark:text-slate-300">
            {project.completed
              ? `Mark "${project.name}" as active again?`
              : `Mark "${project.name}" as complete? You can reopen it any time.`}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCompleteModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleToggleComplete}>{project.completed ? 'Reopen' : 'Mark Complete'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}