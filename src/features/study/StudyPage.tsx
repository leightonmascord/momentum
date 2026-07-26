import { useState, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { useData } from '../../app/providers'
import { db } from '../../db/app-db'
import { isoNow } from '../../lib/utils'
import { useUndo } from '../../lib/use-undo'
import { getDueCount, getUrgencyColor } from '../../lib/fsrs-scheduler'
import { Button } from '../../components/ui/Button'
import { Card, CardTitle } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { v4 as uuid } from 'uuid'
import { Link } from 'react-router-dom'
import type { StudyArea } from '../../domain/types'
import { createInitialState, isDueToday } from '../../lib/fsrs-scheduler'



export default function StudyPage() {
  const { data, loadData } = useData()
  const { push: pushUndo } = useUndo()
  const [showModal, setShowModal] = useState(false)
  const [editArea, setEditArea] = useState<StudyArea | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [tags, setTags] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const activeAreas = useMemo(
    () => data.studyAreas.filter((a) => !a.deletedAt),
    [data.studyAreas]
  )

  const subjects = useMemo(
    () => data.subjects.filter((s) => !s.deletedAt),
    [data.subjects]
  )

  const dueCount = useMemo(
    () => getDueCount(activeAreas),
    [activeAreas]
  )

  const areasBySubject = useMemo(() => {
    const groups: Record<string, StudyArea[]> = {}
    activeAreas.forEach((area) => {
      if (!groups[area.subjectId]) groups[area.subjectId] = []
      groups[area.subjectId].push(area)
    })
    return groups
  }, [activeAreas])

  function openModal(area?: StudyArea) {
    if (area) {
      setEditArea(area)
      setName(area.name)
      setDescription(area.description || '')
      setSubjectId(area.subjectId)
      setTags(area.tags?.join(', ') || '')
      setTags(area.tags?.join(', ') || '')
    } else {
      setEditArea(null)
      setName('')
      setDescription('')
      setSubjectId(subjects[0]?.id || '')
      setTags('')
      setTags('')
    }
    setShowModal(true)
  }

  async function handleSave() {
    if (!name.trim() || !subjectId) return

    const now = isoNow()
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean)

    if (editArea) {
      const updated: StudyArea = {
        ...editArea,
        name: name.trim(),
        description: description.trim() || undefined,
        subjectId,
        tags: tagList.length ? tagList : undefined,
        updatedAt: now,
      }
      await db.studyAreas.put(updated)
      pushUndo({
        description: `Updated "${name}"`,
        undo: async () => { await db.studyAreas.put(editArea); await loadData() },
        redo: async () => { await db.studyAreas.put(updated); await loadData() },
      })
    } else {
      const newArea: StudyArea = {
        id: uuid(),
        subjectId,
        name: name.trim(),
        description: description.trim() || undefined,
        tags: tagList.length ? tagList : undefined,
        fsrs: createInitialState(now),
        createdAt: now,
        updatedAt: now,
      }
      await db.studyAreas.add(newArea)
      pushUndo({
        description: `Added "${name}"`,
        undo: async () => { await db.studyAreas.delete(newArea.id); await loadData() },
        redo: async () => { await db.studyAreas.add(newArea); await loadData() },
      })
    }
    await loadData()
    setShowModal(false)
  }

  async function handleDelete(id: string) {
    const area = activeAreas.find((a) => a.id === id)
    if (!area) return

    const now = isoNow()
    const deleted: StudyArea = { ...area, deletedAt: now, updatedAt: now }
    await db.studyAreas.put(deleted)
    pushUndo({
      description: `Deleted "${area.name}"`,
      undo: async () => { await db.studyAreas.put(area); await loadData() },
      redo: async () => { await db.studyAreas.put(deleted); await loadData() },
    })
    await loadData()
    setDeleteConfirm(null)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Study Areas</h1>
          <p className="text-slate-600 dark:text-slate-400">Conceptual topics to master with spaced repetition</p>
        </div>
        <div className="flex gap-3">
          {dueCount > 0 && (
            <Link to="/study/review">
              <Button variant="primary">
                Review ({dueCount})
              </Button>
            </Link>
          )}
          <Button onClick={() => openModal()}>+ Add Area</Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <CardTitle className="text-sm">Due Today</CardTitle>
          <p className="text-3xl font-bold text-amber-600">{dueCount}</p>
        </Card>
        <Card className="p-4">
          <CardTitle className="text-sm">Total Areas</CardTitle>
          <p className="text-3xl font-bold">{activeAreas.length}</p>
        </Card>
        <Card className="p-4">
          <CardTitle className="text-sm">Subjects</CardTitle>
          <p className="text-3xl font-bold">{subjects.length}</p>
        </Card>
      </div>

      {/* Areas by subject */}
      {Object.keys(areasBySubject).length === 0 ? (
        <EmptyState
          title="No study areas yet"
          description="Add your first study area to start tracking mastery with spaced repetition."
          action={<Button onClick={() => openModal()}>+ Add Study Area</Button>}
        />
      ) : (
        <div className="space-y-6">
          {Object.entries(areasBySubject).map(([sid, areas]) => {
            const subject = subjects.find((s) => s.id === sid)
            const subjectName = subject?.name || 'Unknown'
            return (
              <div key={sid}>
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-3">
                  {subjectName}
                </h2>
                <div className="grid gap-3">
                  {areas.map((area) => {
                    const due = isDueToday(area)
                    const urgencyColor = getUrgencyColor(area)
                    const nextDate = parseISO(area.fsrs.nextReview)
                    const nextStr = format(nextDate, 'MMM d')

                    return (
                      <Card key={area.id} className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium">{area.name}</h3>
                              {due && (
                                <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 rounded">
                                  Due
                                </span>
                              )}
                              {area.fsrs.state === 'learning' && (
                                <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded">
                                  Learning
                                </span>
                              )}
                              {area.examMode?.enabled && (
                                <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 rounded">
                                  Exam {format(parseISO(area.examMode.dueDate), 'MMM d')}
                                </span>
                              )}
                            </div>
                            {area.description && (
                              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                {area.description}
                              </p>
                            )}
                            <p className={`text-xs mt-1 ${urgencyColor}`}>
                              Next: {nextStr} ({area.fsrs.interval.toFixed(1)} days)
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="secondary" onClick={() => openModal(area)}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => setDeleteConfirm(area.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editArea ? 'Edit Study Area' : 'Add Study Area'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Japanese particles"
              className="w-full px-3 py-2 border rounded-md bg-white dark:bg-slate-800 dark:border-slate-700 text-slate-800 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">Subject</label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-white dark:bg-slate-800 dark:border-slate-700 text-slate-800 dark:text-slate-100"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes, links, or context..."
              rows={3}
              className="w-full px-3 py-2 border rounded-md bg-white dark:bg-slate-800 dark:border-slate-700 text-slate-800 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">Tags (comma-separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="grammar, n5, jlpt"
              className="w-full px-3 py-2 border rounded-md bg-white dark:bg-slate-800 dark:border-slate-700 text-slate-800 dark:text-slate-100"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!name.trim() || !subjectId}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Study Area">
        <p className="mb-4 text-slate-600 dark:text-slate-300">Are you sure you want to delete this study area? This action cannot be undone.</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete</Button>
        </div>
      </Modal>
    </div>
  )
}