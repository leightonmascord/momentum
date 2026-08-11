// FSRS-5 based spaced repetition scheduler for Study Areas.
import { sessionLocalDate } from './utils'

import { format } from 'date-fns'
import type { FsrsState, ReviewRating } from '../domain/types'

// ─── FSRS-5 default parameters ───
const W = [
  0.4,   // w0  — initial stability
  0.6,   // w1  — initial stability (Again)
  2.4,   // w2  — initial difficulty
  5.8,   // w3  — initial stability (Easy)
  4.93,  // w4  — initial stability (Good, high D)
  0.94,  // w5  — difficulty change (rating - 3)
  0.86,  // w6  — difficulty change (rating - 3, hard/easy)
  0.01,  // w7  — difficulty mean-reversion weight
  1.49,  // w8  — stability decay (hard)
  0.14,  // w9  — stability decay (easy)
  0.94,  // w10 — stability multiplier (Again → relearning)
  0.42,  // w11 — stability offset (relearning)
  0.0,   // w12 — mean reversion to D_avg
  1.0,   // w13 — hard multiplier
  0.0,   // w14 — easy stability bonus
  0.9,   // w15 — relearning stability multiplier
  0.0,   // w16
  0.0,   // w17
  2.0,   // w18
]

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

const DAY_MS = 86_400_000

// ─── Initial state ───

export interface NewFsrsState {
  state: FsrsState['state']
  stability: number
  difficulty: number
  lastReview: string | null
  nextReview: string
  interval: number
  repetitions: number
}

export function createInitialState(now: string): NewFsrsState {
  return {
    state: 'new',
    stability: W[0],
    difficulty: W[2],
    lastReview: null,
    nextReview: now,
    interval: 0,
    repetitions: 0,
  }
}

// ─── Scheduling ───

export interface ScheduledState {
  state: FsrsState['state']
  stability: number
  difficulty: number
  lastReview: string
  nextReview: string
  interval: number
  repetitions: number
}

export function scheduleReview(
  current: FsrsState,
  rating: ReviewRating,
  reviewedAt: string,
  examMode?: { enabled: boolean; dueDate: string } | null,
  maxReviewInterval?: number | null,
): ScheduledState {
  let { stability, difficulty, state, repetitions } = current

  const reviewed = new Date(reviewedAt)

  if (state === 'new') {
    return scheduleNew(rating, reviewed, examMode, maxReviewInterval)
  }
  // Subsequent reviews
  if (rating === 1) {
    // Again → relearning
    state = 'relearning'
    const newStab = W[10] * stability * Math.exp(W[8] * (1 - difficulty))
    stability = Math.max(0.1, newStab)
    difficulty = clamp(difficulty + W[7] * (10 - difficulty), 1, 10)
    const intervalDays = Math.max(0.01, stability * 0.3) // short relearning step
    repetitions = 0
    return buildResult(state, stability, difficulty, intervalDays, reviewed, repetitions, examMode, maxReviewInterval)
  }

  // Rating >= 2: successful recall
  state = repetitions === 0 && current.state === 'learning' ? 'review' : state
  if (current.state === 'relearning') state = 'review'

  // Difficulty update (mean-reversion + rating influence)
  const dDelta = W[7] * (10 - difficulty) + W[5] * (rating - 3)
  difficulty = clamp(difficulty + dDelta, 1, 10)

  // Stability update
  if (rating === 2) {
    // Hard
    stability = Math.max(0.1, W[15] * stability)
  } else if (rating === 3) {
    // Good
    stability = stability * (1 + Math.exp(W[6]) * (11 - difficulty) * Math.pow(stability, -W[8]))
  } else {
    // Easy
    stability = stability * Math.exp(W[9] * (10 - difficulty))
  }

  stability = Math.max(0.1, stability)
  repetitions++

  let intervalDays: number
  if (rating === 2) {
    intervalDays = Math.max(1, stability * 0.5)
  } else if (rating === 3) {
    intervalDays = stability
  } else {
    intervalDays = stability * 1.5
  }

  intervalDays = Math.max(1, intervalDays)
  return buildResult(state, stability, difficulty, intervalDays, reviewed, repetitions, examMode, maxReviewInterval)
}

function scheduleNew(
  rating: ReviewRating,
  reviewed: Date,
  examMode?: { enabled: boolean; dueDate: string } | null,
  maxReviewInterval?: number | null,
): ScheduledState {
  let stability: number
  let difficulty: number
  let intervalDays: number
  let state: FsrsState['state']
  let repetitions: number
  switch (rating) {
    case 1: // Again
      stability = W[1]
      difficulty = W[2]
      intervalDays = 10 / 1440 // 10 minutes
      state = 'learning'
      repetitions = 0
      break
    case 2: // Hard
      stability = W[0] * 1.5
      difficulty = clamp(W[2] + W[5] * (2 - 3), 1, 10)
      intervalDays = 1
      state = 'learning'
      repetitions = 1
      break
    case 3: // Good
      stability = W[3]
      difficulty = W[2]
      intervalDays = Math.max(1, stability)
      state = 'review'
      repetitions = 1
      break
    case 4: // Easy
      stability = W[4]
      difficulty = clamp(W[2] + W[5] * (4 - 3), 1, 10)
      intervalDays = Math.max(1, stability * 1.5)
      state = 'review'
      repetitions = 1
      break
  }
  return buildResult(state, stability, difficulty, intervalDays, reviewed, repetitions, examMode, maxReviewInterval)
}

function buildResult(
  state: FsrsState['state'],
  stability: number,
  difficulty: number,
  intervalDays: number,
  reviewed: Date,
  repetitions: number,
  examMode?: { enabled: boolean; dueDate: string } | null,
  maxReviewInterval?: number | null,
): ScheduledState {
  // Exam mode: compress intervals so reviews complete before the exam
  // Only honor exam mode if the due date is actually in the future relative to
  // the review date — past dates would either produce negative intervals or
  // collapse the schedule incorrectly.
  if (examMode?.enabled && examMode.dueDate) {
    const examDate = new Date(examMode.dueDate)
    const remainingDays = (examDate.getTime() - reviewed.getTime()) / DAY_MS
    if (Number.isFinite(remainingDays) && remainingDays > 0) {
      // Force interval into remaining window
      // New/learning areas get accelerated
      if (state === 'new' || state === 'learning') {
        intervalDays = Math.min(intervalDays, remainingDays * 0.2)
      }
      // If stability exceeds remaining time, force a review sooner
      if (stability > remainingDays) {
        intervalDays = remainingDays * 0.3
      }
      // Cap any interval so the area is reviewed at least once more before exam
      intervalDays = Math.min(intervalDays, remainingDays * 0.5)
    }
  }
  // Optional user-defined ceiling: cap the interval so certain areas
  // (e.g. vocab discovered to be stable enough for 5 months) still cycle
  // back at least once a month. Must be a positive number of days.
  if (typeof maxReviewInterval === 'number' && maxReviewInterval > 0) {
    intervalDays = Math.min(intervalDays, maxReviewInterval)
  }
  const nextReview = new Date(reviewed.getTime() + intervalDays * DAY_MS)
  return {
    state,
    stability,
    difficulty,
    lastReview: reviewed.toISOString(),
    nextReview: nextReview.toISOString(),
    interval: intervalDays,
    repetitions,
  }
}
// ─── Query helpers ───

export function isDueToday(area: { fsrs: FsrsState }): boolean {
  const next = sessionLocalDate(area.fsrs.nextReview) // YYYY-MM-DD
  const today = format(new Date(), 'yyyy-MM-dd')
  return next <= today
}

export function isOverdue(area: { fsrs: FsrsState }): boolean {
  const next = sessionLocalDate(area.fsrs.nextReview)
  const today = format(new Date(), 'yyyy-MM-dd')
  return next < today
}

export function getDueCount(areas: StudyAreaLike[]): number {
  return areas.filter((a) => !a.deletedAt && isDueToday(a)).length
}

export type StudyAreaLike = { deletedAt?: string | null; fsrs: FsrsState }

// ─── Urgency indicators ───

export type UrgencyLevel = 'overdue' | 'due-today' | 'soon' | 'upcoming'

const URGENCY_COLORS: Record<UrgencyLevel, string> = {
  overdue: 'text-red-600 dark:text-red-400',
  'due-today': 'text-amber-600 dark:text-amber-400',
  soon: 'text-blue-600 dark:text-blue-400',
  upcoming: 'text-slate-500 dark:text-slate-400',
}

export function getUrgency(area: { fsrs: FsrsState }): UrgencyLevel {
  const next = sessionLocalDate(area.fsrs.nextReview)
  const today = format(new Date(), 'yyyy-MM-dd')
  const tomorrow = format(new Date(Date.now() + DAY_MS), 'yyyy-MM-dd')
  const threeDays = format(new Date(Date.now() + 3 * DAY_MS), 'yyyy-MM-dd')

  if (next < today) return 'overdue'
  if (next < tomorrow) return 'due-today'
  if (next < threeDays) return 'soon'
  return 'upcoming'
}

export function getUrgencyColor(area: { fsrs: FsrsState }): string {
  return URGENCY_COLORS[getUrgency(area)]
}

// ─── Rating labels ───

export interface RatingLabel {
  value: ReviewRating
  label: string
  color: string
  description: string
}

export const RATING_LABELS: RatingLabel[] = [
  { value: 1, label: 'Again', color: 'bg-red-500', description: 'Complete blackout. Couldn\'t recall anything' },
  { value: 2, label: 'Hard', color: 'bg-orange-500', description: 'Significant difficulty. Partial recall only' },
  { value: 3, label: 'Good', color: 'bg-emerald-500', description: 'Comfortable recall. Correct after some thought' },
  { value: 4, label: 'Easy', color: 'bg-blue-500', description: 'Instant recall. No hesitation at all' },
]
