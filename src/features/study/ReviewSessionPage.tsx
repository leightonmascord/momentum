import { useState, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { useData } from '../../app/providers'
import { db } from '../../db/app-db'
import { cn, isoNow } from '../../lib/utils'
import { useUndo } from '../../lib/use-undo'
import { isDueToday, scheduleReview, RATING_LABELS } from '../../lib/fsrs-scheduler'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { v4 as uuid } from 'uuid'
import { Link } from 'react-router-dom'
import type { StudyArea, StudyReview, ReviewRating } from '../../domain/types'

export default function ReviewSessionPage() {
  const { data, loadData } = useData()
  const { push: pushUndo } = useUndo()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [minutesSpent, setMinutesSpent] = useState(10)
  const [notes, setNotes] = useState('')
  const [showRating, setShowRating] = useState(false)

  const activeAreas = useMemo(
    () => data.studyAreas.filter((a) => !a.deletedAt && isDueToday(a)),
    [data.studyAreas]
  )

  const currentArea = activeAreas[currentIndex] || null

  const subjects = useMemo(
    () => {
      const map = new Map<string, string>()
      data.subjects.forEach((s) => map.set(s.id, s.name))
      return map
    },
    [data.subjects]
  )

  async function handleRating(rating: ReviewRating) {
    if (!currentArea) return

    const reviewedAt = isoNow()
    const examMode = currentArea.examMode ?? null
    const maxReviewInterval = currentArea.maxReviewInterval ?? null
    // Compute next FSRS state
    const nextFsrs = scheduleReview(currentArea.fsrs, rating, reviewedAt, examMode, maxReviewInterval)

    // Update the area with new FSRS state
    const updatedArea: StudyArea = {
      ...currentArea,
      fsrs: nextFsrs,
      updatedAt: reviewedAt,
    }

    // Log the review
    const review: StudyReview = {
      id: uuid(),
      areaId: currentArea.id,
      rating,
      minutesSpent,
      notes: notes.trim() || undefined,
      reviewedAt,
    }

    // Save both in one go
    await db.studyAreas.put(updatedArea)
    await db.studyReviews.add(review)

    pushUndo({
      description: `Reviewed "${currentArea.name}" (${RATING_LABELS[rating - 1].label})`,
      undo: async () => {
        // Revert area to previous state
        await db.studyAreas.put(currentArea)
        // Delete the review log
        await db.studyReviews.delete(review.id)
        await loadData()
      },
      redo: async () => {
        await db.studyAreas.put(updatedArea)
        await db.studyReviews.add(review)
        await loadData()
      },
    })
    await loadData()
    // Move to next
    if (currentIndex < activeAreas.length - 1) {
      setCurrentIndex(currentIndex + 1)
      setMinutesSpent(10)
      setNotes('')
    } else {
      setSessionComplete(true)
    }
  }

  if (activeAreas.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <EmptyState
          title="No areas due today"
          description="Great job! You've reviewed all your study areas. Come back tomorrow for more."
          action={
            <Link to="/study">
              <Button>Back to Study Areas</Button>
            </Link>
          }
        />
      </div>
    )
  }

  if (sessionComplete) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">Session Complete!</h2>
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            You reviewed {activeAreas.length} study area{activeAreas.length === 1 ? '' : 's'} today.
          </p>
          <Link to="/study">
            <Button>Back to Study Areas</Button>
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link to="/study">
          <Button variant="secondary">← Back</Button>
        </Link>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {currentIndex + 1} of {activeAreas.length}
        </p>
      </div>

      {/* Current area card */}
      {currentArea && (
        <Card className="p-6">
          <div className="mb-4">
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {subjects.get(currentArea.subjectId)}
            </span>
            <h1 className="text-2xl font-bold mt-1">{currentArea.name}</h1>
          </div>

          {currentArea.description && (
            <p className="text-slate-700 dark:text-slate-300 mb-6">
              {currentArea.description}
            </p>
          )}

          {currentArea.tags && currentArea.tags.length > 0 && (
            <div className="flex gap-2 mb-6">
              {currentArea.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 text-xs bg-slate-100 dark:bg-slate-700 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Exam mode indicator */}
          {currentArea.examMode?.enabled && (
            <div className="mb-6 p-3 bg-purple-50 dark:bg-purple-900/30 rounded-lg">
              <p className="text-sm text-purple-700 dark:text-purple-300">
                📚 Exam mode: due {format(parseISO(currentArea.examMode.dueDate), 'MMM d, yyyy')}
              </p>
            </div>
          )}

          {/* Current state */}
          <div className="grid grid-cols-3 gap-4 mb-6 text-sm">
            <div>
              <p className="text-slate-500">Stability</p>
              <p className="font-medium">{currentArea.fsrs.stability.toFixed(1)} days</p>
            </div>
            <div>
              <p className="text-slate-500">Difficulty</p>
              <p className="font-medium">{currentArea.fsrs.difficulty.toFixed(1)}</p>
            </div>
            <div>
              <p className="text-slate-500">Reviews</p>
              <p className="font-medium">{currentArea.fsrs.repetitions}</p>
            </div>
          </div>

          {/* Rating section */}
          {!showRating ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  How long did you spend? (minutes)
                </label>
                <input
                  type="number"
                  value={minutesSpent}
                  onChange={(e) => setMinutesSpent(Math.min(180, Math.max(1, parseInt(e.target.value) || 1)))}
                  min={1}
                  max={180}
                  className="w-24 px-3 py-2 border rounded-md dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="What did you review? Any insights?"
                  rows={3}
                  className="w-full px-3 py-2 border rounded-md dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <Button onClick={() => setShowRating(true)} className="w-full">
                Continue to Rating
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="font-medium">How confident are you?</p>
              {RATING_LABELS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => handleRating(r.value)}
                  className={cn(
                    'w-full p-4 text-left rounded-lg border transition-colors',
                    'hover:border-primary-500 dark:hover:border-primary-400',
                    r.color === 'bg-red-500' ? 'bg-red-50 dark:bg-red-900/20' :
                    r.color === 'bg-orange-500' ? 'bg-orange-50 dark:bg-orange-900/20' :
                    r.color === 'bg-emerald-500' ? 'bg-emerald-50 dark:bg-emerald-900/20' :
                    'bg-blue-50 dark:bg-blue-900/20',
                    'border-slate-200 dark:border-slate-700'
                  )}
                >
                  <div className="font-medium">{r.label}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">{r.description}</div>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Progress */}
      <div className="flex gap-1">
        {activeAreas.map((_, idx) => (
          <div
            key={idx}
            className={cn(
              'flex-1 h-2 rounded-full',
              idx < currentIndex ? 'bg-primary-600' :
              idx === currentIndex ? 'bg-primary-400' : 'bg-slate-200 dark:bg-slate-700'
            )}
          />
        ))}
      </div>
    </div>
  )
}