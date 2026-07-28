import Dexie, { type Table } from 'dexie'
import type {
  Activity,
  ActivityLog,
  Assignment,
  Category,
  Habit,
  HabitLog,
  Mark,
  Project,
  ProgressLog,
  Routine,
  RoutineLog,
  Session,
  StreakDay,
  Subject,
  StudyArea,
  StudyReview,
  PendingSyncOp,
} from '../domain/types'

const SEED_KEY = 'momentum-seeded'

const SEED_CATEGORIES: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>[] = [
  { name: 'Academic', scope: 'academic', color: '#3b82f6' },
  { name: 'Hobbies', scope: 'nonAcademic', color: '#10b981' },
  { name: 'Miscellaneous', scope: 'nonAcademic', color: '#f59e0b' },
]

export class AppDB extends Dexie {
  categories!: Table<Category, string>
  subjects!: Table<Subject, string>
  projects!: Table<Project, string>
  sessions!: Table<Session, string>
  progressLogs!: Table<ProgressLog, string>
  marks!: Table<Mark, string>
  assignments!: Table<Assignment, string>
  habits!: Table<Habit, string>
  habitLogs!: Table<HabitLog, string>
  streakDays!: Table<StreakDay, string>
  routines!: Table<Routine, string>
  routineLogs!: Table<RoutineLog, string>
  activities!: Table<Activity, string>
  activityLogs!: Table<ActivityLog, string>
  studyAreas!: Table<StudyArea, string>
  studyReviews!: Table<StudyReview, string>
  pendingSyncOps!: Table<PendingSyncOp, string>

  constructor() {
    super('study-app')
    this.version(1).stores({
      categories: 'id, scope, name',
      subjects: 'id, categoryId, name',
      projects: 'id, subjectId, name',
      tasks: 'id, projectId, orderIndex',
      sessions: 'id, subjectId, projectId, startAt',
      progressLogs: 'id, subjectId, loggedAt',
    })
    this.version(2).stores({
      marks: 'id, subjectId, date',
      assignments: 'id, subjectId, dueDate, completed',
      habits: 'id, kind',
      habitLogs: 'id, habitId, date',
      streakDays: 'id, totalMinutes, goalMet',
    })
    // v3: add letterGrade index for filter/sort (no schema change needed, but bump to be safe)
    this.version(4).stores({
      marks: 'id, subjectId, date, letterGrade',
      assignments: 'id, subjectId, dueDate, completed, category',
    })
    this.version(6).stores({
      sessions: 'id, subjectId, projectId, assignmentId, startAt',
    })
    this.version(7).stores({
      routines: 'id, subjectId, name',
      routineLogs: 'id, routineId, date',
    })
    this.version(8).stores({
      hobbies: 'id, category, name',
      hobbySessions: 'id, hobbyId, startAt',
    })
    this.version(9).stores({
      studyAreas: 'id, subjectId, deletedAt',
      studyReviews: 'id, areaId, reviewedAt',
    })
    this.version(10).stores({
      pendingSyncOps: 'id, tableKey',
    })
    // v11: schedule entries (orphaned, kept for Dexie upgrade chain)
    this.version(11).stores({
      scheduleEntries: 'id, subjectId, dayOfWeek, [subjectId+dayOfWeek]',
    })
    // v12: add completed index for projects
    this.version(12).stores({
      projects: 'id, subjectId, name, completed',
    })
    // v13: add activities + activityLogs tables
    this.version(13).stores({
      activities: 'id, subjectId, name',
      activityLogs: 'id, activityId, date',
    })
    // v14: migrate Routine records from days+targetMinutes to dayMinutes
    this.version(14).stores({
      routines: 'id, subjectId, name',
    }).upgrade(async (tx) => {
      await tx.table('routines').toCollection().modify((routine: any) => {
        if (!routine.dayMinutes && Array.isArray(routine.days) && typeof routine.targetMinutes === 'number') {
          const dm: Record<number, number> = {}
          for (const d of routine.days) {
            dm[d] = routine.targetMinutes
          }
          routine.dayMinutes = dm
        }
        // Ensure dayMinutes exists even if migration couldn't convert
        if (!routine.dayMinutes) routine.dayMinutes = {}
        // Clean up old fields
        delete routine.days
        delete routine.targetMinutes
        delete routine.autoLog
        delete routine.autoLogMinutes
        delete routine.skippedWeekStart
      })
    })
    // v15: add parentSubjectId for subject hierarchy
    this.version(15).stores({
      subjects: 'id, categoryId, name, parentSubjectId',
    }).upgrade(async (tx) => {
      await tx.table('subjects').toCollection().modify((subject: any) => {
        if (subject.parentSubjectId === undefined) {
          subject.parentSubjectId = null
        }
      })
    })
    // v16: add projectId index to assignments so project soft-delete can
    // cascade-update assignments via a Dexie indexed query.
    this.version(16).stores({
      assignments: 'id, subjectId, projectId, dueDate, completed, category',
    })
  }
}

export const db = new AppDB()

/** Seed default categories on first launch. Safe to call multiple times. */
export async function seedDefaults() {
  if (typeof localStorage === 'undefined') return
  if (localStorage.getItem(SEED_KEY)) return

  const existing = await db.categories.count()
  if (existing > 0) {
    localStorage.setItem(SEED_KEY, '1')
    return
  }

  const now = new Date().toISOString()
  await db.categories.bulkAdd(
    SEED_CATEGORIES.map((c, i) => ({
      ...c,
      id: `cat-seed-${i}`,
      createdAt: now,
      updatedAt: now,
    }))
  )
  localStorage.setItem(SEED_KEY, '1')
}
