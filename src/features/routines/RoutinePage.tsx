import { useState, useMemo } from 'react'
import { format, subDays } from 'date-fns'
import { useData } from '../../app/providers'
import { db } from '../../db/app-db'
import { cn, isoNow } from '../../lib/utils'
import { Button } from '../../components/ui/Button'
import { useUndo } from '../../lib/use-undo'
import { Card, CardHeader, CardTitle } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { ColorPicker } from '../../components/ui/ColorPicker'
import { v4 as uuid } from 'uuid'
import { TodaysRoutinesList } from '../../components/widgets/TodaysRoutinesList'
import type { Routine, RoutineLog, DayOfWeek, Session } from '../../domain/types'
import { sessionIdFor } from '../../lib/timer-persistence'

const DEFAULT_COLOR = '#6366f1'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function RoutinePage() {
  const { data, loadData } = useData()
  const { push } = useUndo()
  const [showModal, setShowModal] = useState(false)
  const [editRoutine, setEditRoutine] = useState<Routine | null>(null)
  const [name, setName] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [notes, setNotes] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [logMinutesRoutineId, setLogMinutesRoutineId] = useState<string | null>(null)
  const [logMinutesValue, setLogMinutesValue] = useState(0)
  const [isEditingGrid, setIsEditingGrid] = useState(false)
  const [gridDrafts, setGridDrafts] = useState<Record<string, Record<number, string>>>({})

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const todayDow = new Date().getDay() as DayOfWeek

  const activeRoutines = data.routines.filter((r) => !r.deletedAt)

  const subjectsMap = useMemo(
    () => new Map(data.subjects.filter(s => !s.deletedAt).map(s => [s.id, s])),
    [data.subjects]
  )

  const projectsForSubject = useMemo(() => {
    if (!subjectId) return []
    return data.projects.filter((p) => p.subjectId === subjectId && !p.deletedAt)
  }, [data.projects, subjectId])

  const weekDates = useMemo(() => {
    const today = new Date()
    const sunday = subDays(today, today.getDay())
    return Array.from({ length: 7 }).map((_, i) => format(subDays(sunday, -i), 'yyyy-MM-dd'))
  }, [])

  const weekLogsByDate = useMemo(() => {
    const map: Record<string, RoutineLog[]> = {}
    weekDates.forEach((d) => { map[d] = [] })
    data.routineLogs.forEach((log) => {
      if (weekDates.includes(log.date) && map[log.date]) {
        map[log.date].push(log)
      }
    })
    return map
  }, [data.routineLogs, weekDates])

  const weeklyProgress = useMemo(() => {
    return activeRoutines.map((routine) => {
      const weeklyLogs = weekDates.reduce<RoutineLog[]>((acc, d) => {
        const dayLogs = weekLogsByDate[d]?.filter((l) => l.routineId === routine.id) ?? []
        return acc.concat(dayLogs)
      }, [])
      const totalLogged = weeklyLogs.reduce((sum, l) => sum + l.actualMinutes, 0)
      const scheduledDays = Object.entries(routine.dayMinutes).filter(([, m]) => m > 0).length
      const totalTarget = Object.values(routine.dayMinutes).reduce((sum, m) => sum + (m ?? 0), 0)
      return {
        name: routine.name,
        subject: getSubjectName(routine.subjectId),
        scheduledDays,
        totalTarget,
        totalLogged,
        progress: totalTarget > 0 ? Math.round((totalLogged / totalTarget) * 100) : 0,
      }
    })
  }, [activeRoutines, weekDates, weekLogsByDate])

  function getSubjectName(id: string): string {
    return data.subjects.find((s) => s.id === id)?.name ?? 'Unknown'
  }

  function getProjectName(id: string | null | undefined): string {
    if (!id) return ''
    return data.projects.find((p) => p.id === id)?.name ?? ''
  }

  function initGridDrafts() {
    const drafts: Record<string, Record<number, string>> = {}
    for (const r of activeRoutines) {
      const dayDrafts: Record<number, string> = {}
      for (let d = 0; d < 7; d++) {
        const val = r.dayMinutes[d as DayOfWeek]
        dayDrafts[d] = val != null && val > 0 ? String(val) : ''
      }
      drafts[r.id] = dayDrafts
    }
    setGridDrafts(drafts)
  }

  function openAddRoutine() {
    setEditRoutine(null)
    setName('')
    setSubjectId('')
    setProjectId(null)
    setColor(DEFAULT_COLOR)
    setNotes('')
    setShowModal(true)
  }

  function openEditRoutine(routine: Routine) {
    setEditRoutine(routine)
    setName(routine.name)
    setSubjectId(routine.subjectId)
    setProjectId(routine.projectId ?? null)
    setColor(routine.color)
    setNotes(routine.notes ?? '')
    setShowModal(true)
  }

  async function saveRoutine() {
    if (!name.trim() || !subjectId) return
    try {
      if (editRoutine) {
        const prev = { ...editRoutine }
        await db.routines.update(editRoutine.id, {
          name: name.trim(),
          subjectId,
          projectId: projectId ?? undefined,
          color,
          notes: notes || undefined,
          updatedAt: isoNow(),
        })
        push({
          description: `Updated routine "${name.trim()}"`,
          undo: async () => { await db.routines.update(prev.id, prev); await loadData() },
          redo: async () => {
            await db.routines.update(prev.id, {
              name: name.trim(), subjectId, projectId: projectId ?? undefined,
              color, notes: notes || undefined, updatedAt: isoNow(),
            })
            await loadData()
          },
        })
      } else {
        const newId = uuid()
        const newRoutine: Routine = {
          id: newId, name: name.trim(), subjectId,
          projectId: projectId ?? undefined,
          dayMinutes: {},
          color,
          notes: notes || undefined,
          createdAt: isoNow(), updatedAt: isoNow(),
        }
        await db.routines.add(newRoutine)
        push({
          description: `Added routine "${newRoutine.name}"`,
          undo: async () => { await db.routines.delete(newId); await loadData() },
          redo: async () => { await db.routines.add(newRoutine); await loadData() },
        })
      }
      setShowModal(false)
      await loadData()
    } catch (e) {
      console.error('Failed to save routine', e)
    }
  }

  async function deleteRoutineFn(id: string) {
    try {
      const routine = data.routines.find((r) => r.id === id)
      if (!routine) return
      const prev = { ...routine }
      await db.routines.update(id, { deletedAt: isoNow(), updatedAt: isoNow() })
      push({
        description: `Deleted routine "${prev.name}"`,
        undo: async () => {
          await db.routines.update(id, { deletedAt: null, updatedAt: isoNow() })
          await loadData()
        },
        redo: async () => {
          await db.routines.update(id, { deletedAt: prev.deletedAt ?? null, updatedAt: isoNow() })
          await loadData()
        },
      })
      setDeleteConfirm(null)
      await loadData()
    } catch (e) {
      console.error('Failed to delete routine', e)
    }
  }

  async function saveLogMinutes() {
    if (!logMinutesRoutineId || logMinutesValue <= 0) return
    const routine = activeRoutines.find((r) => r.id === logMinutesRoutineId)
    if (!routine) return
    const newLogId = uuid()
    const target = routine.dayMinutes[todayDow] ?? 0
    const newLog: RoutineLog = {
      id: newLogId,
      routineId: routine.id,
      date: todayStr,
      actualMinutes: logMinutesValue,
      completed: logMinutesValue >= target,
      createdAt: isoNow(),
    }
    try {
      // Create a matching Session so the minutes count toward today's total
      // and the streak, the same way `markDone` does (M10 fix).
      const now = new Date()
      const start = new Date(now.getTime() - logMinutesValue * 60_000)
      const startAt = start.toISOString()
      const session: Session = {
        id: sessionIdFor(startAt, routine.subjectId, logMinutesValue),
        subjectId: routine.subjectId,
        projectId: routine.projectId ?? null,
        routineId: routine.id,
        startAt,
        endAt: now.toISOString(),
        durationMinutes: logMinutesValue,
        source: 'manual',
        createdAt: isoNow(),
        updatedAt: isoNow(),
      }
      await db.sessions.put(session)
      await db.routineLogs.add(newLog)
      push({
        description: `Logged ${logMinutesValue} min for "${routine.name}"`,
        undo: async () => {
          await db.routineLogs.delete(newLogId)
          await db.sessions.delete(session.id)
          await loadData()
        },
        redo: async () => {
          await db.routineLogs.add(newLog)
          await db.sessions.put(session)
          await loadData()
        },
      })
      setLogMinutesRoutineId(null)
      setLogMinutesValue(0)
      await loadData()
    } catch (e) {
      console.error('Failed to log minutes', e)
    }
  }

  async function saveGrid() {
    const updates: { id: string; prev: Routine; dayMinutes: Partial<Record<DayOfWeek, number>> }[] = []
    for (const r of activeRoutines) {
      const draft = gridDrafts[r.id]
      if (!draft) continue
      const dayMinutes: Partial<Record<DayOfWeek, number>> = {}
      for (let d = 0; d < 7; d++) {
        const v = draft[d]
        const n = v ? parseInt(v, 10) : 0
        if (n > 0) dayMinutes[d as DayOfWeek] = n
      }
      updates.push({ id: r.id, prev: { ...r }, dayMinutes })
    }
    try {
      for (const u of updates) {
        await db.routines.update(u.id, { dayMinutes: u.dayMinutes, updatedAt: isoNow() })
      }
      push({
        description: `Updated ${updates.length} routine${updates.length !== 1 ? 's' : ''}`,
        undo: async () => {
          for (const u of updates) {
            await db.routines.update(u.id, { dayMinutes: u.prev.dayMinutes, updatedAt: isoNow() })
          }
          await loadData()
        },
        redo: async () => {
          for (const u of updates) {
            await db.routines.update(u.id, { dayMinutes: u.dayMinutes, updatedAt: isoNow() })
          }
          await loadData()
        },
      })
      setIsEditingGrid(false)
      setGridDrafts({})
      await loadData()
    } catch (e) {
      console.error('Failed to save grid', e)
    }
  }

  function setGridDraft(routineId: string, dayOfWeek: number, value: string) {
    setGridDrafts((prev) => ({
      ...prev,
      [routineId]: { ...prev[routineId], [dayOfWeek]: value },
    }))
  }

  function startEditing() {
    initGridDrafts()
    setIsEditingGrid(true)
  }

  function cancelEditing() {
    setIsEditingGrid(false)
    setGridDrafts({})
  }

  const days: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Routines</h2>
        <Button variant="primary" size="sm" onClick={openAddRoutine}>Add Routine</Button>
      </div>

      {/* Today's routines progress */}
      <TodaysRoutinesList
        routines={data.routines}
        routineLogs={data.routineLogs}
        subjects={data.subjects}
        todayStr={todayStr}
        todayDow={todayDow}
        maxItems={6}
        clickable
      />

      {/* Weekly Grid */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Weekly Schedule</CardTitle>
            <div className="flex gap-2">
              {isEditingGrid ? (
                <>
                  <Button variant="secondary" size="sm" onClick={cancelEditing}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={saveGrid}>Save</Button>
                </>
              ) : (
                <Button variant="secondary" size="sm" onClick={startEditing}>Edit</Button>
              )}
            </div>
          </div>
        </CardHeader>
        {activeRoutines.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Create a routine to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500">
                  <th className="pb-2 pr-3 font-medium">Routine</th>
                  {days.map((d) => (
                    <th key={d} className="pb-2 px-2 font-medium text-center">{WEEKDAYS[d]}</th>
                  ))}
                  <th className="pb-2 pl-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeRoutines.map((routine) => {
                  const subject = subjectsMap.get(routine.subjectId)
                  return (
                    <tr key={routine.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: routine.color }} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{routine.name}</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {subject?.name ?? 'Unknown'}
                              {routine.projectId && <>{' · '}{getProjectName(routine.projectId)}</>}
                            </div>
                          </div>
                        </div>
                      </td>
                      {days.map((d) => {
                        const draft = gridDrafts[routine.id]?.[d]
                        const savedVal = routine.dayMinutes[d as DayOfWeek]
                        return (
                          <td key={d} className="py-1 px-2 text-center align-middle">
                            {isEditingGrid ? (
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                className="w-16 text-center rounded border border-slate-200 bg-white px-1 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                placeholder="min"
                                value={draft ?? ''}
                                onChange={(e) => setGridDraft(routine.id, d, e.target.value)}
                              />
                            ) : (
                              <span className="text-xs text-slate-700 dark:text-slate-300">
                                {savedVal != null && savedVal > 0 ? savedVal : '—'}
                              </span>
                            )}
                          </td>
                        )
                      })}
                      <td className="py-1 pl-2 text-right align-middle whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              const target = routine.dayMinutes[todayDow] ?? 0
                              setLogMinutesValue(target > 0 ? target : 30)
                              setLogMinutesRoutineId(routine.id)
                            }}
                          >
                            Log
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => openEditRoutine(routine)}>Edit</Button>
                          <Button variant="danger" size="sm" onClick={() => setDeleteConfirm(routine.id)}>Del</Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Weekly Summary */}
      {activeRoutines.length > 0 && (
        <Card>
          <CardHeader><CardTitle>This Week</CardTitle></CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Subject</th>
                  <th className="pb-2 font-medium">Scheduled Days</th>
                  <th className="pb-2 font-medium">Total</th>
                  <th className="pb-2 font-medium">Logged</th>
                  <th className="pb-2 font-medium">Progress</th>
                </tr>
              </thead>
              <tbody>
                {weeklyProgress.map((rp, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="py-2 font-medium text-slate-800 dark:text-slate-100">{rp.name}</td>
                    <td className="py-2 text-slate-600 dark:text-slate-400">{rp.subject}</td>
                    <td className="py-2 text-slate-600 dark:text-slate-400">{rp.scheduledDays}</td>
                    <td className="py-2 text-slate-600 dark:text-slate-400">{rp.totalTarget}m</td>
                    <td className="py-2 text-slate-600 dark:text-slate-400">{rp.totalLogged}m</td>
                    <td className="py-2">
                      <span className={cn('font-medium', rp.progress >= 100 ? 'text-green-600 dark:text-green-400' : rp.progress >= 50 ? 'text-yellow-600 dark:text-yellow-400' : 'text-slate-500 dark:text-slate-400')}>{rp.progress}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Empty state */}
      {activeRoutines.length === 0 && (
        <EmptyState title="No routines" description="Create a weekly study routine to track your progress." />
      )}

      {/* Add/Edit Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editRoutine ? 'Edit Routine' : 'Add Routine'}
      >
        <div className="space-y-3">
          <input className="input" placeholder="Name (e.g. Math Study Block)" value={name} onChange={(e) => setName(e.target.value)} />

          <select className="input" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setProjectId(null) }}>
            <option value="">Select Focus Area</option>
            {data.subjects.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>

          {subjectId && projectsForSubject.length > 0 && (
            <select className="input" value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)}>
              <option value="">No Project (optional)</option>
              {projectsForSubject.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
            <textarea className="input mt-1 min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes for this routine" />
          </div>

          <ColorPicker value={color} onChange={setColor} />

          <Button variant="primary" className="w-full" onClick={saveRoutine} disabled={!name.trim() || !subjectId}>
            {editRoutine ? 'Save' : 'Add'}
          </Button>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Routine?"
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This will soft-delete the routine. You can restore it later from the database if needed.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onClick={() => deleteConfirm && deleteRoutineFn(deleteConfirm)}>Delete</Button>
          </div>
        </div>
      </Modal>

      {/* Log Minutes Modal */}
      <Modal
        open={logMinutesRoutineId !== null}
        onClose={() => setLogMinutesRoutineId(null)}
        title="Log Minutes"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Minutes</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="input mt-1"
              value={logMinutesValue <= 0 ? '' : String(logMinutesValue)}
              onChange={(e) => {
                const v = e.target.value
                if (v === '') { setLogMinutesValue(0); return }
                const n = Number(v)
                if (isNaN(n)) return
                setLogMinutesValue(Math.max(0, Math.min(480, n)))
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Date</label>
            <input type="text" className="input mt-1" value={todayStr} readOnly />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setLogMinutesRoutineId(null)}>Cancel</Button>
            <Button variant="primary" className="flex-1" onClick={saveLogMinutes} disabled={logMinutesValue <= 0}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
