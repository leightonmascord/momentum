import { format } from 'date-fns'
import type { Session } from '../../domain/types'
import { formatMinutes } from '../../lib/utils'

interface SessionDetailsModalProps {
  session: Session | null
  onClose: () => void
  open: boolean
  subjectName?: string
  projectName?: string
}

export function SessionDetailsModal({ session, onClose, open, subjectName, projectName }: SessionDetailsModalProps) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-lg shadow-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Session Details</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-lg"
            aria-label="Close"
          >
            ×
          </button>
        </div>

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

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
