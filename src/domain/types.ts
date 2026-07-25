// Domain types for the study app

export type Scope = 'academic' | 'nonAcademic'

export interface Category {
  id: string
  name: string
  scope: Scope
  color: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface Subject {
  id: string
  categoryId: string
  name: string
  color: string
  parentSubjectId?: string | null
  routine?: number[]
  weeklyTargetMinutes?: number
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface Project {
  id: string
  subjectId: string
  name: string
  description?: string
  dailyTargetMinutes?: number
  weeklyTargetMinutes?: number
  goalMinutes?: number
  totalTargetMinutes?: number
  dueDate?: string
  completed?: boolean
  completedAt?: string | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}


export interface Session {
  id: string
  subjectId: string
  projectId?: string | null
  assignmentId?: string | null
  routineId?: string | null
  startAt: string // ISO
  endAt: string // ISO
  durationMinutes: number
  durationSeconds?: number
  note?: string
  source: 'manual' | 'timer' | 'pomodoro' | 'quickLog' | 'autoRoutine'
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  focusTag?: 'focused' | 'distracted' | 'group' | 'revision'
  noTime?: boolean
}

export interface ProgressLog {
  id: string
  subjectId: string
  loggedAt: string // ISO
  value: number
  unit?: string
  note?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

// Mark tracker — for academic subjects
export interface Mark {
  id: string
  subjectId: string
  name: string // e.g. "Midterm", "Assignment 1"
  score: number // mark achieved
  total: number // maximum possible
  averageMark?: number | null // class average (optional)
  weight: number // weighting percentage (0-100)
  letterGrade?: string | null // e.g. "A", "B+", "C"; auto-computed if omitted
  date: string // ISO date
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

// Task tracker — simple tasks with category & weighting for grade tracking
export type TaskCategory = 'homework' | 'assignments' | 'miscellaneous'

export interface Assignment {
  id: string
  subjectId: string
  projectId?: string | null
  title: string
  description?: string
  dueDate: string // ISO date; empty string = no due date
  category: TaskCategory // homework | assignments | miscellaneous
  weight: number // percentage weight (0-100) of the final grade; 0 if not graded
  completed: boolean
  orderIndex?: number
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export const TASK_CATEGORIES: { value: TaskCategory; label: string; color: string }[] = [
  { value: 'homework', label: 'Homework', color: '#3b82f6' },
  { value: 'assignments', label: 'Assignments', color: '#a855f7' },
  { value: 'miscellaneous', label: 'Miscellaneous', color: '#64748b' },
]

// Habit tracker
export type HabitKind = 'good' | 'bad'
export type HabitMode = 'count' | 'tick'

export interface Habit {
  id: string
  name: string
  kind: HabitKind
  mode: HabitMode
  color: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  archivedAt?: string | null
  // Distinct from archivedAt: a finished/graduated habit is one the user has
  // permanently established. It stops appearing as an active habit and moves
  // to a "Finished" section, but is preserved separately from the archive.
  finishedAt?: string | null
  archivedAfterDays?: number | null
  status?: 'active' | 'potential'
  targetPerDay?: number
}

export interface HabitLog {
  id: string
  habitId: string
  date: string // ISO date (YYYY-MM-DD)
  time?: string // HH:MM time of day
  note?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  value?: number
  focusTag?: 'focused' | 'distracted' | 'group' | 'revision'
}

// Streak — one row per day that had study activity
export interface StreakDay {
  id: string // the date string YYYY-MM-DD
  totalMinutes: number
  goalMet: boolean
  createdAt: string
}

// Routines — weekly study schedule

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6  // 0=Sun, 6=Sat

export interface Routine {
  id: string
  name: string                // e.g. 'Math Study Block'
  subjectId: string           // which focus area
  projectId?: string | null   // optional project within that focus area
  dayMinutes: Partial<Record<DayOfWeek, number>>
  color: string               // hex color for display
  notes?: string              // optional routine notes
  scheduledTime?: string      // optional HH:mm for display only
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface RoutineLog {
  id: string
  routineId: string
  date: string               // ISO date YYYY-MM-DD
  actualMinutes: number      // how much was actually studied
  completed: boolean         // true if actualMinutes >= targetMinutes
  createdAt: string
}


// Activities — recurring external commitments (lessons, tutoring, etc.)
// Distinct from Routines (self-directed study blocks) and Subjects (focus areas).
export interface Activity {
  id: string
  name: string
  subjectId: string | null
  dayMinutes: Partial<Record<DayOfWeek, number>>
  /** Default duration in minutes for any scheduled day (used when dayMinutes[dow] is not set) */
  duration?: number
  /** When true, marking the activity 'attended' auto-creates a Session record */
  createsSession?: boolean
  scheduledTime?: string
  notes?: string
  color: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface ActivityLog {
  id: string
  activityId: string
  date: string                // YYYY-MM-DD
  status: 'completed' | 'skipped' | 'pending'
  actualMinutes?: number
  createdAt: string
}

// Study Areas — FSRS-based spaced repetition for conceptual topics

export type ReviewRating = 1 | 2 | 3 | 4  // again, hard, good, easy

export interface FsrsState {
  state: 'new' | 'learning' | 'review' | 'relearning'
  stability: number     // how long memory lasts (days)
  difficulty: number    // how hard the content is (1-10)
  lastReview: string | null  // ISO date
  nextReview: string    // ISO date — due when <= today
  interval: number      // current interval in days
  repetitions: number   // successful reviews count
}

export interface StudyArea {
  id: string
  subjectId: string
  name: string           // e.g., "Japanese particles"
  description?: string   // optional notes/links
  tags?: string[]        // e.g., ["grammar", "n5"]
  fsrs: FsrsState
  examMode?: {
    enabled: boolean
    dueDate: string      // exam date
  } | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface StudyReview {
  id: string
  areaId: string
  rating: ReviewRating
  minutesSpent: number   // how long you spent reviewing
  notes?: string         // what you did during review
  reviewedAt: string     // ISO timestamp
}

export interface PendingSyncOp {
  id: string // uuid
  tableKey: string
  timestamp: string
}
