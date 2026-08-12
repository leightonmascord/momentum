import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { v4 as uuid } from 'uuid'
import { useData } from '../../app/providers'
import { db } from '../../db/app-db'
import { cn, formatMinutes, isoNow, getSubjectPickerOptions, getSubjectPathLabel, toLocalDateString } from '../../lib/utils'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { useUndo } from '../../lib/use-undo'
import { PageSpinner } from '../../components/ui/Spinner'
import type { Project } from '../../domain/types'

interface ProjectFormData {
  name: string
  subjectId: string
  description: string
  goalType: 'daily' | 'weekly' | 'total'
  goalMinutes: number
  dueDate: string
}

const emptyFormData: ProjectFormData = {
  name: '',
  subjectId: '',
  description: '',
  goalType: 'total',
  goalMinutes: 60,
  dueDate: '',
}

export default function ProjectsPage() {
  const { data, isLoading, loadData } = useData()
  const { push: pushUndo } = useUndo()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [deleteProject, setDeleteProject] = useState<Project | null>(null)
  const [formData, setFormData] = useState<ProjectFormData>(emptyFormData)
  const [isSaving, setIsSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'active' | 'completed' | 'all'>('active')
  const [error, setError] = useState('')

  const visibleProjects = useMemo(
    () => data.projects.filter((p) => !p.deletedAt && (statusFilter === 'all' || (statusFilter === 'active' ? !p.completed : p.completed === true))),
    [data.projects, statusFilter]
  )

  const handleOpenModal = (project?: Project) => {
    if (project) {
      setEditingProject(project)
      const goalType = project.dailyTargetMinutes ? 'daily' : project.weeklyTargetMinutes ? 'weekly' : 'total'
      const goalMinutes = project.dailyTargetMinutes ?? project.weeklyTargetMinutes ?? project.totalTargetMinutes ?? 60
      setFormData({
        name: project.name,
        subjectId: project.subjectId,
        description: project.description || '',
        goalType,
        goalMinutes,
        dueDate: project.dueDate ?? '',
      })
    } else {
      setEditingProject(null)
      setFormData({
        ...emptyFormData,
        subjectId: data.subjects[0]?.id || '',
      })
    }
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingProject(null)
    setFormData(emptyFormData)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim() || !formData.subjectId) return
    setIsSaving(true)
    try {
      const now = isoNow()
      const dueDate = formData.dueDate || undefined
      const targetPatch = formData.goalType === 'daily'
        ? { dailyTargetMinutes: formData.goalMinutes, weeklyTargetMinutes: undefined, totalTargetMinutes: undefined }
        : formData.goalType === 'weekly'
          ? { dailyTargetMinutes: undefined, weeklyTargetMinutes: formData.goalMinutes, totalTargetMinutes: undefined }
          : { dailyTargetMinutes: undefined, weeklyTargetMinutes: undefined, totalTargetMinutes: formData.goalMinutes }

      if (editingProject) {
        await db.projects.update(editingProject.id, {
          name: formData.name.trim(),
          subjectId: formData.subjectId,
          description: formData.description.trim() || undefined,
          ...targetPatch,
          dueDate,
          updatedAt: now,
        })
      } else {
        const newProject: Project = {
          id: uuid(),
          name: formData.name.trim(),
          subjectId: formData.subjectId,
          description: formData.description.trim() || undefined,
          ...targetPatch,
          dueDate,
          createdAt: now,
          updatedAt: now,
        }
        await db.projects.add(newProject)
      }
      await loadData()
      handleCloseModal()
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteProject) return
    setIsSaving(true)
    setError('')
    try {
      const now = isoNow()
      const originalProject = { ...deleteProject }
      const projectId = deleteProject.id

      // Soft-delete project + cascade to assignments and sessions in a single
      // transaction so all related writes succeed or fail together.
      await db.transaction(
        'rw',
        db.projects,
        db.assignments,
        db.sessions,
        async () => {
          await db.projects.update(projectId, { deletedAt: now, updatedAt: now })
          await db.assignments.where('projectId').equals(projectId).modify({ deletedAt: now, updatedAt: now })
          await db.sessions.where('projectId').equals(projectId).modify({ deletedAt: now, updatedAt: now })
        }
      )
      await loadData()

      pushUndo({
        description: `Deleted project "${originalProject.name}"`,
        undo: async () => {
          await db.transaction(
            'rw',
            db.projects,
            db.assignments,
            db.sessions,
            async () => {
              await db.projects.update(projectId, { deletedAt: null, updatedAt: isoNow() })
              await db.assignments.where('projectId').equals(projectId).modify({
                deletedAt: null,
                updatedAt: isoNow()
              })
              await db.sessions.where('projectId').equals(projectId).modify({
                deletedAt: null,
                updatedAt: isoNow()
              })
            }
          )
          await loadData()
        },
        redo: async () => {
          await db.transaction(
            'rw',
            db.projects,
            db.assignments,
            db.sessions,
            async () => {
              await db.projects.update(projectId, { deletedAt: now, updatedAt: isoNow() })
              await db.assignments.where('projectId').equals(projectId).modify({
                deletedAt: now,
                updatedAt: isoNow()
              })
              await db.sessions.where('projectId').equals(projectId).modify({
                deletedAt: now,
                updatedAt: isoNow()
              })
            }
          )
          await loadData()
        },
      })
      setDeleteProject(null)
    } catch (e) {
      console.error('[deleteProject] Failed:', e)
      setError(`Failed to delete project: ${String(e)}`)
      // Refresh UI so a partially-deleted state doesn't linger
      await loadData()
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) return <PageSpinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Projects</h2>
        <Button variant="primary" size="sm" onClick={() => handleOpenModal()}>
          Add Project
        </Button>
      </div>
      <div className="inline-flex rounded-full bg-slate-200 p-1 dark:bg-slate-700">
        {(['active', 'completed', 'all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'rounded-full px-4 py-1 text-sm font-medium capitalize transition-colors',
              statusFilter === s
                ? 'bg-white text-slate-800 shadow dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-800 dark:text-slate-400'
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {visibleProjects.length === 0 ? (
        <EmptyState
          title={statusFilter === 'completed' ? 'No completed projects' : statusFilter === 'active' ? 'No active projects' : 'No projects yet'}
          description={statusFilter === 'completed' ? 'Projects you finish will show up here.' : 'Add a project to track your study goals.'}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleProjects.map((project) => {
            const totalMinutes = data.sessions.filter((s) => s.projectId === project.id && !s.deletedAt).reduce((sum, s) => sum + s.durationMinutes, 0)
            const openTasks = data.assignments.filter((a) => a.projectId === project.id && !a.completed && !a.deletedAt).length
            const goalTarget = project.dailyTargetMinutes ?? project.weeklyTargetMinutes ?? project.totalTargetMinutes ?? 0
            const todayStr = format(new Date(), 'yyyy-MM-dd')
            const weekStartDate = new Date()
            weekStartDate.setDate(weekStartDate.getDate() - weekStartDate.getDay())
            weekStartDate.setHours(0, 0, 0, 0)
            const effectiveMinutes = project.dailyTargetMinutes
              ? data.sessions.filter((s) => s.projectId === project.id && toLocalDateString(s.startAt) === todayStr).reduce((sum, s) => sum + s.durationMinutes, 0)
              : project.weeklyTargetMinutes
                ? data.sessions.filter((s) => s.projectId === project.id && new Date(s.startAt) >= weekStartDate).reduce((sum, s) => sum + s.durationMinutes, 0)
                : totalMinutes
            const goalLabel = project.dailyTargetMinutes ? 'daily' : project.weeklyTargetMinutes ? 'weekly' : 'total'
            const goalPct = goalTarget > 0 ? Math.min(100, Math.round((effectiveMinutes / goalTarget) * 100)) : 0
            return (
              <Link key={project.id} to={`/projects/${project.id}`} className="block">
                <Card className="h-full cursor-pointer transition-shadow hover:shadow-md">
                  <div className="flex flex-col h-full">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-800 dark:text-slate-100 truncate">{project.name}</div>
                        <div className="mt-1 text-sm text-slate-500">{getSubjectPathLabel(project.subjectId, data.subjects)}</div>
                      </div>
                      <div className="flex gap-1 ml-2" onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
                        <Button variant="secondary" size="sm" onClick={() => handleOpenModal(project)} className="px-2 py-1">Edit</Button>
                        <Button variant="danger" size="sm" onClick={() => setDeleteProject(project)} className="px-2 py-1">Delete</Button>
                      </div>
                    </div>
                    {project.description && (
                      <div className="mt-2 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{project.description}</div>
                    )}
                    <div className="mt-3 flex items-center gap-3 text-sm">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{formatMinutes(totalMinutes)}</span>
                      <span className="text-xs text-slate-500">logged</span>
                      {openTasks > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium dark:bg-slate-700">{openTasks} task{openTasks !== 1 ? 's' : ''}</span>}
                    </div>
                    {project.completed && (
                      <div className="mt-2 text-xs font-medium text-green-600 dark:text-green-400">
                        ✓ Completed{project.completedAt ? ` ${format(parseISO(project.completedAt), 'd MMM yyyy')}` : ''}
                      </div>
                    )}
                    {!project.completed && goalTarget > 0 && (
                      <div className="mt-2">
                        <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700">
                          <div className={cn('h-1.5 rounded-full transition-all', goalPct >= 100 ? 'bg-green-500' : 'bg-primary-500')} style={{ width: `${goalPct}%` }} />
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatMinutes(effectiveMinutes)} / {formatMinutes(goalTarget)} · {goalLabel} goal · {goalPct}%
                        </div>
                      </div>
                    )}
                    {project.dueDate && (() => {
                      const daysUntil = differenceInCalendarDays(parseISO(project.dueDate), new Date())
                      let pillClass = ''
                      let label = ''
                      if (daysUntil < 0) {
                        pillClass = 'text-red-600 bg-red-50'
                        label = 'Overdue'
                      } else if (daysUntil <= 3) {
                        pillClass = 'text-amber-600 bg-amber-50'
                        label = 'Due soon'
                      } else if (daysUntil <= 7) {
                        pillClass = 'text-blue-600 bg-blue-50'
                        label = 'Upcoming'
                      }
                      return (
                        <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                          <span>Deadline: {format(parseISO(project.dueDate), 'MMM d, yyyy')}</span>
                          {label && (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${pillClass}`}>{label}</span>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title={editingProject ? 'Edit Project' : 'Add Project'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className="input"
              placeholder="Enter project name"
              required
            />
          </div>
          <div>
            <label className="label">Focus Area</label>
            <select
              value={formData.subjectId}
              onChange={(e) => setFormData((prev) => ({ ...prev, subjectId: e.target.value }))}
              className="input"
              required
            >
              <option value="">Select a focus area</option>
              {getSubjectPickerOptions(data.subjects).map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              className="input min-h-[80px] resize-y"
              placeholder="Optional description"
            />
          </div>
          <div>
            <label className="label">Deadline Date (optional)</label>
            <input
              type="date"
              value={formData.dueDate}
              onChange={(e) => setFormData((prev) => ({ ...prev, dueDate: e.target.value }))}
              className="input w-full"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="label">Goal Type</label>
              <select
                value={formData.goalType}
                onChange={(e) => setFormData((prev) => ({ ...prev, goalType: e.target.value as 'daily' | 'weekly' | 'total' }))}
                className="input"
              >
                <option value="daily">Daily Target</option>
                <option value="weekly">Weekly Target</option>
                <option value="total">Total Project Target</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="label">Goal Minutes</label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={formData.goalMinutes === 0 ? '' : String(formData.goalMinutes)} onChange={(e) => { const v = e.target.value; if (v === '') { setFormData((prev) => ({ ...prev, goalMinutes: 0 })); return }; const n = Number(v); if (isNaN(n)) return; setFormData((prev) => ({ ...prev, goalMinutes: Math.max(1, n) })) }} className="input" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSaving}>
              {isSaving ? 'Saving...' : editingProject ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteProject}
        onClose={() => setDeleteProject(null)}
        title="Delete Project"
      >
        <div className="space-y-4">
          <p className="text-slate-600 dark:text-slate-300">
            Are you sure you want to delete{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              {deleteProject?.name}
            </span>
            ? This will archive the project.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteProject(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={isSaving}>
              {isSaving ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}