import { useState, useMemo } from 'react'
import { format } from 'date-fns'
import { useData } from '../../app/providers'
import { db } from '../../db/app-db'
import { cn, isoNow, getSubjectPathLabel, getSubjectPickerOptions } from '../../lib/utils'
import { useUndo } from '../../lib/use-undo'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { ColorPicker } from '../../components/ui/ColorPicker'
import { v4 as uuid } from 'uuid'
import type { Activity, ActivityLog, DayOfWeek, Session } from '../../domain/types'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DEFAULT_COLOR = '#6366f1'

export default function ActivitiesPage() {
  const { data, mutate } = useData()
  const { push } = useUndo()

  const [showModal, setShowModal] = useState(false)
  const [editActivity, setEditActivity] = useState<Activity | null>(null)
  const [name, setName] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [scheduledTime, setScheduledTime] = useState('')
  const [notes, setNotes] = useState('')

  const [dayFilter, setDayFilter] = useState<DayOfWeek | 'all'>(new Date().getDay() as DayOfWeek)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [pendingLog, setPendingLog] = useState<Activity | null>(null)

  const [isEditingGrid, setIsEditingGrid] = useState(false)
  const [gridDrafts, setGridDrafts] = useState<Record<string, Record<number, string>>>({})

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const todayDow = new Date().getDay() as DayOfWeek

  const activeActivities = useMemo(
    () => data.activities.filter((a) => !a.deletedAt).sort((a, b) => {
      const nameA = a.name.toLowerCase(), nameB = b.name.toLowerCase()
      if (nameA < nameB) return -1
      if (nameA > nameB) return 1
      return 0
    }),
    [data.activities],
  )

  const filteredActivities = useMemo(
    () =>
      dayFilter === 'all'
        ? activeActivities
        : activeActivities.filter((a) => (a.dayMinutes[dayFilter] ?? 0) > 0),
    [activeActivities, dayFilter],
  )

  function resetForm() {
    setName('')
    setSubjectId('')
    setColor(DEFAULT_COLOR)
    setScheduledTime('')
    setNotes('')
  }

  function openAdd() {
    setEditActivity(null)
    resetForm()
    setShowModal(true)
  }

  function openEdit(activity: Activity) {
    setEditActivity(activity)
    setName(activity.name)
    setSubjectId(activity.subjectId ?? '')
    setColor(activity.color)
    setScheduledTime(activity.scheduledTime ?? '')
    setNotes(activity.notes ?? '')
    setShowModal(true)
  }

  async function saveActivity() {
    const trimmedName = name.trim()
    if (!trimmedName) return

    const now = isoNow()
    try {
      if (editActivity) {
        const prev = await db.activities.get(editActivity.id)
        const updated = {
          name: trimmedName,
          subjectId: subjectId || null,
          color,
          scheduledTime: scheduledTime || undefined,
          notes: notes.trim() || undefined,
          updatedAt: now,
        }
        await db.activities.update(editActivity.id, updated)
        mutate(prevData => ({ ...prevData, activities: prevData.activities.map(a => a.id === editActivity.id ? { ...a, ...updated } : a) }))
        setShowModal(false)
        if (prev) {
          push({
            description: `Updated activity "${trimmedName}"`,
            undo: async () => {
              await db.activities.put(prev)
              mutate(p => ({ ...p, activities: p.activities.map(a => a.id === editActivity.id ? prev : a) }))
            },
            redo: async () => {
              await db.activities.update(editActivity.id, updated)
              mutate(p => ({ ...p, activities: p.activities.map(a => a.id === editActivity.id ? { ...a, ...updated } : a) }))
            },
          })
        }
      } else {
        const newActivity: Activity = {
          id: uuid(),
          name: trimmedName,
          subjectId: subjectId || null,
          dayMinutes: {},
          color,
          scheduledTime: scheduledTime || undefined,
          notes: notes.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        }
        await db.activities.add(newActivity)
        mutate(prev => ({ ...prev, activities: [...prev.activities, newActivity] }))
        setShowModal(false)
        resetForm()
        push({
          description: `Added activity "${trimmedName}"`,
          undo: async () => {
            await db.activities.delete(newActivity.id)
            mutate(prev => ({ ...prev, activities: prev.activities.filter(a => a.id !== newActivity.id) }))
          },
          redo: async () => {
            await db.activities.add(newActivity)
            mutate(prev => ({ ...prev, activities: [...prev.activities, newActivity] }))
          },
        })
      }
    } catch (e) {
      console.error('Failed to save activity', e)
    }
  }

  async function deleteActivityFn(id: string) {
    try {
      const activity = data.activities.find((a) => a.id === id)
      if (!activity) return
      const now = isoNow()
      await db.activities.update(id, { deletedAt: now, updatedAt: now })
      mutate(prev => ({ ...prev, activities: prev.activities.map(a => a.id === id ? { ...a, deletedAt: now, updatedAt: now } : a) }))
      setDeleteConfirm(null)
      push({
        description: `Deleted activity "${activity.name}"`,
        undo: async () => {
          await db.activities.update(id, { deletedAt: null, updatedAt: isoNow() })
          mutate(prev => ({ ...prev, activities: prev.activities.map(a => a.id === id ? { ...a, deletedAt: null, updatedAt: isoNow() } : a) }))
        },
        redo: async () => {
          await db.activities.update(id, { deletedAt: now, updatedAt: now })
          mutate(prev => ({ ...prev, activities: prev.activities.map(a => a.id === id ? { ...a, deletedAt: now, updatedAt: now } : a) }))
        },
      })
    } catch (e) {
      console.error('Failed to delete activity', e)
    }
  }

  function getMostRecentScheduledDay(scheduledDows: DayOfWeek[]): string {
    const now = new Date()
    const today = now.getDay()
    for (let offset = 0; offset < 7; offset++) {
      const candidateDow = (today - offset + 7) % 7
      if (scheduledDows.includes(candidateDow as DayOfWeek)) {
        const d = new Date(now)
        d.setDate(now.getDate() - offset)
        return format(d, 'yyyy-MM-dd')
      }
    }
    return format(now, 'yyyy-MM-dd')
  }

  async function confirmLog(activity: Activity, status: 'completed' | 'skipped') {
    try {
      const now = isoNow()
      // Use the most recent scheduled day as the default date
      const scheduledDows = (Object.keys(activity.dayMinutes) as unknown as DayOfWeek[]).filter(
        (d) => (activity.dayMinutes[d] ?? 0) > 0
      )
      const logDate = scheduledDows.length > 0 ? getMostRecentScheduledDay(scheduledDows) : todayStr
      const log: ActivityLog = {
        id: uuid(),
        activityId: activity.id,
        date: logDate,
        status,
        createdAt: now,
      }
      if (status === 'completed') {
        log.actualMinutes = activity.duration || activity.dayMinutes[todayDow as DayOfWeek] || 30
      }
      await db.activityLogs.add(log)
      let sessionToUndo: Session | null = null
      if (status === 'completed' && activity.subjectId) {
        const minutes = log.actualMinutes ?? 30
        const session: Session = {
          id: uuid(),
          subjectId: activity.subjectId,
          startAt: new Date(new Date(logDate + 'T12:00:00').getTime() - minutes * 60000).toISOString(),
          endAt: new Date(new Date(logDate + 'T12:00:00')).toISOString(),
          durationMinutes: minutes,
          source: 'quickLog',
          note: `Activity: ${activity.name}`,
          createdAt: now,
          updatedAt: now,
        }
        sessionToUndo = session
        await db.sessions.add(session)
      }
      mutate(prev => ({ ...prev, activityLogs: [...prev.activityLogs, log], sessions: sessionToUndo ? [...prev.sessions, sessionToUndo] : prev.sessions }))
      setPendingLog(null)
      push({
        description: `Logged ${status} activity: ${activity.name}`,
        undo: async () => {
          await db.activityLogs.delete(log.id)
          if (sessionToUndo) await db.sessions.delete(sessionToUndo.id)
          mutate(prev => ({ ...prev, activityLogs: prev.activityLogs.filter(l => l.id !== log.id), sessions: sessionToUndo ? prev.sessions.filter(s => s.id !== sessionToUndo.id) : prev.sessions }))
        },
        redo: async () => {
          await db.activityLogs.add(log)
          if (sessionToUndo) await db.sessions.add(sessionToUndo)
          mutate(prev => ({ ...prev, activityLogs: [...prev.activityLogs, log], sessions: sessionToUndo ? [...prev.sessions, sessionToUndo] : prev.sessions }))
        },
      })
    } catch (e) {
      console.error('Failed to log activity', e)
    }
  }

  function initGridDrafts() {
    const drafts: Record<string, Record<number, string>> = {}
    for (const a of activeActivities) {
      const dayDrafts: Record<number, string> = {}
      for (let d = 0; d < 7; d++) {
        const val = a.dayMinutes[d as DayOfWeek]
        dayDrafts[d] = val != null && val > 0 ? String(val) : ''
      }
      drafts[a.id] = dayDrafts
    }
    setGridDrafts(drafts)
  }

  function setGridDraft(activityId: string, dayOfWeek: number, value: string) {
    setGridDrafts((prev) => ({
      ...prev,
      [activityId]: { ...prev[activityId], [dayOfWeek]: value },
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

  async function saveGrid() {
    const updates: {
      id: string
      prev: Activity
      dayMinutes: Partial<Record<DayOfWeek, number>>
    }[] = []
    for (const a of activeActivities) {
      const draft = gridDrafts[a.id]
      if (!draft) continue
      const dayMinutes: Partial<Record<DayOfWeek, number>> = {}
      for (let d = 0; d < 7; d++) {
        const v = draft[d]
        const n = v ? parseInt(v, 10) : 0
        if (n > 0) dayMinutes[d as DayOfWeek] = n
      }
      updates.push({ id: a.id, prev: { ...a }, dayMinutes })
    }
    try {
      for (const u of updates) {
        await db.activities.update(u.id, { dayMinutes: u.dayMinutes, updatedAt: isoNow() })
      }
      push({
        description: `Updated ${updates.length} ${updates.length === 1 ? 'activity' : 'activities'}`,
        undo: async () => {
          for (const u of updates) {
            await db.activities.update(u.id, { dayMinutes: u.prev.dayMinutes, updatedAt: isoNow() })
          }
          mutate(prev => ({ ...prev, activities: prev.activities.map(a => { const u = updates.find(x => x.id === a.id); return u ? { ...a, dayMinutes: u.prev.dayMinutes, updatedAt: isoNow() } : a }) }))
        },
        redo: async () => {
          for (const u of updates) {
            await db.activities.update(u.id, { dayMinutes: u.dayMinutes, updatedAt: isoNow() })
          }
          mutate(prev => ({ ...prev, activities: prev.activities.map(a => { const u = updates.find(x => x.id === a.id); return u ? { ...a, dayMinutes: u.dayMinutes, updatedAt: isoNow() } : a }) }))
        },
      })
      setIsEditingGrid(false)
      setGridDrafts({})
      mutate(prev => ({ ...prev, activities: prev.activities.map(a => { const u = updates.find(x => x.id === a.id); return u ? { ...a, dayMinutes: u.dayMinutes, updatedAt: isoNow() } : a }) }))
    } catch (e) {
      console.error('Failed to save grid', e)
    }
  }

  const days: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Activities</h2>
        <Button variant="primary" size="sm" onClick={openAdd}>
          Add Activity
        </Button>
      </div>

      {/* Day filter */}
      <div className="flex flex-wrap gap-1">
        <Button
          variant={dayFilter === 'all' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setDayFilter('all')}
        >
          All
        </Button>
        {WEEKDAYS.map((label, value) => (
          <Button
            key={value}
            variant={dayFilter === value ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setDayFilter(value as DayOfWeek)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* Weekly grid */}
      <Card>
        <div className="flex items-center justify-between p-4 pb-0">
          <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Weekly Schedule
          </h3>
          <div className="flex gap-2">
            {isEditingGrid ? (
              <>
                <Button variant="secondary" size="sm" onClick={cancelEditing}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={saveGrid}>
                  Save
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={startEditing}>
                Edit
              </Button>
            )}
          </div>
        </div>

        {filteredActivities.length === 0 ? (
          <div className="p-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {dayFilter === 'all'
                ? 'No activities yet.'
                : `No activities on ${WEEKDAYS[dayFilter]}.`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto p-4">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500">
                  <th className="pb-2 pr-3 font-medium">Activity</th>
                  <th className="pb-2 px-2 font-medium text-center">Today</th>
                  {days.map((d) => (
                    <th key={d} className="pb-2 px-2 font-medium text-center">
                      {WEEKDAYS[d]}
                    </th>
                  ))}
                  <th className="pb-2 pl-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredActivities.map((activity) => {
                  const subject = data.subjects.find((s) => s.id === activity.subjectId)
                  const todayLog = data.activityLogs.find(log => log.activityId === activity.id && log.date === todayStr)
                  const status = todayLog?.status ?? 'pending'
                  const statusLabel = status === 'completed' ? 'Completed' : status === 'skipped' ? 'Skipped' : 'Pending'
                  const statusColor = status === 'completed' ? 'text-green-600' : status === 'skipped' ? 'text-amber-600' : 'text-slate-500'
                  return (
                    <tr key={activity.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3">
                        <div className="flex items-start gap-3">
                          <div
                            className="mt-1 h-3 w-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: activity.color }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                              {activity.name}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                              {subject && (
                                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                                  {getSubjectPathLabel(activity.subjectId, data.subjects)}
                                </span>
                              )}
                              {activity.scheduledTime && (
                                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                                  {activity.scheduledTime}
                                </span>
                              )}
                              {typeof activity.dayMinutes[todayDow] === 'number' && (activity.dayMinutes[todayDow] ?? 0) > 0 && (
                                <span className="rounded-full border px-2 py-0.5" style={{ borderColor: activity.color, color: activity.color }}>
                                  {activity.dayMinutes[todayDow]} min today
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-1 px-2 text-center align-middle">
                        <span className={cn('text-xs font-medium', statusColor)}>
                          {statusLabel}
                        </span>
                      </td>
                      {days.map((d) => {
                        const draft = gridDrafts[activity.id]?.[d]
                        const savedVal = activity.dayMinutes[d as DayOfWeek]
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
                                onChange={(e) => setGridDraft(activity.id, d, e.target.value)}
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
                          {pendingLog?.id === activity.id ? (
                            <div className="flex gap-1">
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => confirmLog(activity, 'completed')}
                              >
                                Completed
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => confirmLog(activity, 'skipped')}
                              >
                                Skipped
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setPendingLog(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => setPendingLog(activity)}
                            >
                              Log
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => openEdit(activity)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setDeleteConfirm(activity.id)}
                          >
                            Del
                          </Button>
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

      {/* Add/Edit Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editActivity ? 'Edit Activity' : 'Add Activity'}
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Name
            </label>
            <input
              className="input"
              placeholder="e.g. Japanese lesson"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Subject (optional)
            </label>
            <select
              className="input"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">— None —</option>
              {getSubjectPickerOptions(data.subjects).map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Color
            </label>
            <ColorPicker value={color} onChange={setColor} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Scheduled Time
            </label>
            <input
              type="time"
              className="input"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Notes
            </label>
            <textarea
              className="input"
              rows={3}
              placeholder="e.g. Online via Zoom"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button variant="primary" className="w-full" onClick={saveActivity}>
            {editActivity ? 'Save' : 'Add'}
          </Button>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Activity?"
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This will soft-delete the activity. You can undo with Ctrl+Z.
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setDeleteConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => deleteConfirm && deleteActivityFn(deleteConfirm)}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
