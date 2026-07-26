import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import type { Session, Subject } from '../../domain/types'
import { formatMinutes } from '../../lib/utils'
import { FocusTagSelector } from './FocusTagSelector'

type FocusTag = NonNullable<Session['focusTag']>

interface SessionDetailsModalProps {
  session: Session | null
  onClose: () => void
  open: boolean
  subjectName?: string
  projectName?: string
  subjects?: Subject[]
  onSave?: (updates: {
    subjectId: string
    startAt: string
    endAt: string
    durationMinutes: number
    focusTag: FocusTag | undefined
    note: string
  }) => Promise<void> | void
}

function toDateTimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function SessionDetailsModal({
  session,
  onClose,
  open,
  subjectName,
  projectName,
  subjects = [],
  onSave,
}: SessionDetailsModalProps) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    subjectId: '',
    startAt: '',
    endAt: '',
    durationMinutes: 0,
    focusTag: undefined as FocusTag | undefined,
    note: '',
  })

  useEffect(() => {
    if (!session) return
    setForm({
      subjectId: session.subjectId,
      startAt: toDateTimeLocal(session.startAt),
      endAt: toDateTimeLocal(session.endAt),
      durationMinutes: session.durationMinutes,
      focusTag: session.focusTag,
      note: session.note ?? '',
    })
    setEditing(false)
  }, [session])

  if (!session || !open) return null

  const srcLabel =
    session.source === 'timer'
      ? 'Timer'
      : session.source === 'pomodoro'
      ? 'Pomodoro'
      : session.source === 'quickLog'
      ? 'Quick Log'
      : session.source === 'autoRoutine'
      ? 'Routine'
      : 'Manual'

  const startAt = new Date(session.startAt)
  const endAt = new Date(session.endAt)
  const startTime = format(startAt, 'h:mm a')
  const endTime = format(endAt, 'h:mm a')
  const startDate = format(startAt, 'EEE, MMM d, yyyy')

  async function handleSave() {
    if (!onSave) return
    setSaving(true)
    try {
      const newStart = new Date(form.startAt).toISOString()
      const newEnd = new Date(form.endAt).toISOString()
      await onSave({
        subjectId: form.subjectId,
        startAt: newStart,
        endAt: newEnd,
        durationMinutes: form.durationMinutes,
        focusTag: form.focusTag,
        note: form.note,
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-lg shadow-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Session Details</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-lg"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {editing ? (
          <div className="space-y-4">
            {subjects.length > 0 && (
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Subject</label>
                <select
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-2 py-1.5 text-sm"
                  value={form.subjectId}
                  onChange={(e) => setForm({ ...form, subjectId: e.target.value })}
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Start</label>
                <input
                  type="datetime-local"
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-2 py-1.5 text-sm"
                  value={form.startAt}
                  onChange={(e) => {
                    const newStart = e.target.value
                    const newEnd = new Date(new Date(newStart).getTime() + form.durationMinutes * 60_000)
                    const pad = (n: number) => String(n).padStart(2, '0')
                    const endLocal = `${newEnd.getFullYear()}-${pad(newEnd.getMonth() + 1)}-${pad(newEnd.getDate())}T${pad(newEnd.getHours())}:${pad(newEnd.getMinutes())}`
                    setForm({ ...form, startAt: newStart, endAt: endLocal })
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Duration (min)</label>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-2 py-1.5 text-sm"
                  value={form.durationMinutes}
                  onChange={(e) => {
                    const mins = Math.max(0, Number(e.target.value) || 0)
                    const newEnd = new Date(new Date(form.startAt).getTime() + mins * 60_000)
                    const pad = (n: number) => String(n).padStart(2, '0')
                    const endLocal = `${newEnd.getFullYear()}-${pad(newEnd.getMonth() + 1)}-${pad(newEnd.getDate())}T${pad(newEnd.getHours())}:${pad(newEnd.getMinutes())}`
                    setForm({ ...form, durationMinutes: mins, endAt: endLocal })
                  }}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Focus quality</label>
              <FocusTagSelector
                value={form.focusTag ?? null}
                onChange={(v) => setForm({ ...form, focusTag: v ?? undefined })}
              />
            </div>

            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Notes</label>
              <textarea
                className="w-full min-h-[80px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-2 py-1.5 text-sm"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Add session notes…"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 rounded text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 rounded text-sm bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Subject</h3>
                <p className="text-base text-slate-800 dark:text-slate-200">{subjectName || session.subjectId}</p>
              </div>

              {projectName && (
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Project</h3>
                  <p className="text-base text-slate-800 dark:text-slate-200">{projectName}</p>
                </div>
              )}

              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Date</h3>
                <p className="text-base text-slate-800 dark:text-slate-200">{startDate}</p>
              </div>

              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Time</h3>
                <p className="text-base text-slate-800 dark:text-slate-200">
                  {startTime} – {endTime}
                </p>
              </div>

              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Duration</h3>
                <p className="text-base text-slate-800 dark:text-slate-200">
                  {formatMinutes(session.durationMinutes)} {session.durationMinutes === 1 ? 'minute' : 'minutes'}
                </p>
              </div>

              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Source</h3>
                <p className="text-base text-slate-800 dark:text-slate-200">{srcLabel}</p>
              </div>

              {session.focusTag && (
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Focus Quality</h3>
                  <span className="inline-block rounded-full px-2 py-0.5 text-xs border border-primary-300 bg-primary-50 text-primary-800 dark:border-primary-700 dark:bg-primary-900/40 dark:text-primary-200 capitalize">
                    {session.focusTag}
                  </span>
                </div>
              )}

              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes</h3>
                <p className="text-base text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
                  {session.note || <span className="italic text-slate-400">(no notes)</span>}
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              {onSave && (
                <button
                  onClick={() => setEditing(true)}
                  className="px-3 py-1.5 rounded text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100"
                >
                  Edit
                </button>
              )}
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-700 rounded-md text-sm font-medium text-slate-800 dark:text-slate-100"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
