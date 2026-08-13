# Momentum — Specifications & Agent Bootstrap

> This file is the **single source of truth** for the Momentum study app. It is written so that a fresh OMP instance that reads it ("read specs for momentum") is fully equipped to work on the codebase without re-deriving the architecture. It is **self-updating**: every instance that makes a durable change MUST update this file (see §Maintenance Protocol) so the knowledge compounds instead of going stale.

---

## 0. Bootstrap — read this first

If you are a new instance about to work on Momentum, do these in order:

1. **Read this whole file.** It is the ground truth for architecture, conventions, and known pitfalls.
2. **Read `momentum/README.md`** for the user-facing overview and deployment flow.
3. **Read `momentum/.bugfix-plan.md`** — a live enumeration of known bugs (CRITICAL/HIGH/MEDIUM/LOW) with fix sketches. If a bug you are asked to fix is listed there, follow its sketch and mark it done when closed.
4. **Read `momentum/src/domain/types.ts`** — the canonical domain model. When in doubt about a field, this file wins.
5. **Read `momentum/src/db/app-db.ts`** — the Dexie schema (16 versions). Never add a table or index without bumping the version and adding an `.upgrade()` if data migration is needed.
6. **Read `momentum/src/lib/settings-store.ts`** — the settings shape and defaults. This is the ONLY place settings defaults live; do not duplicate them in SettingsPage.
7. **Read `momentum/src/app/router.tsx`** — the real route table (the §Routes table below is derived from it).
8. **Read `momentum/src/app/providers.tsx`** — the data provider contract (`useData()`).
9. **Read `momentum/src/lib/shortcuts.ts`** — the shortcut registry. The registry is canonical; the keydown handler in `AppLayout.tsx` dispatches from it.
10. **Read `momentum/src/lib/use-dashboard-widgets.ts`** — the dashboard widget layout system (grid + freeform).

**Grounding rule:** the code is the source of truth. If this file and the code disagree, the code wins — and you MUST update this file to match (see §Maintenance Protocol). Never trust a stale spec over the actual implementation.

**Verification commands** (run from `momentum/`):
```bash
npx tsc --noEmit      # type-check (MUST pass before any deploy)
npx vitest run        # unit tests
npm run build         # production build
npm run dev           # dev server on :5173
```

---

## 1. Architecture

- **Local-first PWA** — all data in IndexedDB via Dexie. No server, no accounts.
- **Stack**: React 18, TypeScript, Vite, Tailwind CSS (class-based dark mode), Dexie, React Router (hash-based), date-fns, vite-plugin-pwa.
- **Hash routing**: URLs are `/#/subjects` etc. so the app works on static hosts (GitHub Pages) without server config.
- **Dark mode**: On by default. Class `dark` on `<html>`, toggled by Settings. Applied in `App.tsx` via `applyDarkMode(loadSettings().darkMode)`.
- **Provider hierarchy** (from `router.tsx`):
  ```
  AuthProvider > UndoProvider > DataProvider > AppLayout > RouterContent
  ```
- **Data provider**: `useData()` returns `{ data, isLoading, scope, rangePreset, setScope, setRangePreset, loadData, mutate }`.
  - `data` is an `AppData` object (all tables as arrays).
  - `mutate(updater)` applies an in-memory change without re-reading IndexedDB — use after a Dexie write to keep the UI in sync cheaply.
  - Selector hooks: `useDataSelector`, `useSubjects`, `useSessions`, `useAssignments`, etc.
- **Sync**: `data-sync.ts` (`pullAllData` for cloud→local on mount, `loadData` with 80ms debounce for local refresh), `sync-service.ts`, `sync-status.ts`, `settings-sync.ts`, `cloud-backup.ts`, `backup.ts`. Firestore rules in `firestore.rules`. Group presence via `use-group-presence.ts` / `use-all-groups-presence.ts`.

---

## 2. App Name

**Momentum** — branded in the sidebar and `<title>`. Version constant: `VERSION` in `src/lib/version.ts` (currently `0.20.0`). Build id stamped on `window.__MOMENTUM_BUILD_ID__` in `main.tsx`.

---

## 3. Routes (actual, from `router.tsx`)

| Path | Page | Notes |
|------|------|-------|
| `/` | Dashboard | |
| `/subjects` | SubjectsPage | Nav label "Focus Areas" |
| `/projects` | ProjectsPage | |
| `/projects/:id` | ProjectDetailPage | |
| `/marks` | MarksPage | Hidden from nav by default |
| `/habits` | HabitsPage | |
| `/calendar` | CalendarPage | Nav label "Tasks" |
| `/categories` | CategoriesPage | Hidden from nav by default |
| `/reports` | ReportsPage | |
| `/reviews` | AIReviewPage | Nav label "AI Review" |
| `/study` | StudyPage | |
| `/study/review` | ReviewSessionPage | |
| `/study/log` | ReviewLogPage | |
| `/study/exam` | ExamConfigPage | |
| `/schedule` | SchedulePage | Absorbs routines + activities |
| `/routines` | → redirect to `/schedule` | Legacy alias |
| `/activities` | → redirect to `/schedule` | Legacy alias |
| `/groups` | GroupsPage | Hidden from nav by default |
| `/groups/:id` | GroupDetailPage | |
| `/settings` | SettingsPage | |
| `*` | 404 page | |

**Nav items** (from `AppLayout.tsx` `NAV_ITEMS`): Dashboard, Focus Areas, Projects, Tasks, Study, Reports, Habits, Schedule, Marks, Groups, Categories, AI Review, Settings. Order/visibility persisted in `momentum-nav-prefs` (version key `momentum-nav-prefs-version`, `CURRENT_PREFS_VERSION = 4`). Default hidden: marks, groups, categories, reviews.

> **Stale-spec warning:** older specs listed `/routines` and `/hobbies` as separate pages. They are gone — routines and activities both live under `/schedule`, and there is no `/hobbies` route. Do not reintroduce them.

---

## 4. Data Model

### 4.1 Domain types (`src/domain/types.ts`)

Canonical. Key entities:

- **Category**: `id, name, scope ('academic'|'nonAcademic'), color, createdAt, updatedAt, deletedAt?`
- **Subject**: `id, categoryId, name, color, parentSubjectId (null = top-level), routine?, weeklyTargetMinutes?, createdAt, updatedAt, deletedAt?`
  - **Subject hierarchy exists**: `parentSubjectId`, `getChildSubjects`, `getTopLevelSubject`, `getSubjectPathLabel`, `getSubjectPickerOptions` in `utils.ts`.
- **Project**: `id, subjectId, name, description?, goalMinutes?, completed?, createdAt, updatedAt, deletedAt?`
- **Session**: `id, subjectId, projectId?, assignmentId?, startAt, endAt, durationMinutes, durationSeconds?, note?, focusTag?, source, routineId?, createdAt, updatedAt, deletedAt?`
  - `focusTag` is a strict union `'focused' | 'distracted' | 'group' | 'revision' | undefined`. **Never widen it to `string`** in form state or save handlers.
  - `source` values include `'manual'`, `'autoRoutine'`, timer sources, etc.
- **Mark**: `id, subjectId, name, score, total, weight, date, letterGrade?`
- **Assignment** (the "task"): `id, subjectId, projectId?, title, dueDate, type (TaskCategory), completed, category?`
  - `TaskCategory = 'homework' | 'assignments' | 'miscellaneous'`; `TASK_CATEGORIES` array in types.ts.
- **Habit**: `id, name, kind ('good'|'bad'), mode ('count'|'tick'), color, status? ('active'|'potential'), targetPerDay?, archivedAt?, finishedAt?, archivedAfterDays?, createdAt, updatedAt, deletedAt?`
  - **States**: active, potential (`status`), finished (`finishedAt` — graduated, distinct from archive), archived (`archivedAt`).
- **HabitLog**: `id, habitId, date (YYYY-MM-DD), time?, note?, value?, focusTag?, createdAt, updatedAt, deletedAt?`
- **StreakDay**: `id (YYYY-MM-DD), totalMinutes, goalMet`
- **Routine**: `id, name, subjectId, projectId?, dayMinutes (Partial<Record<DayOfWeek, number>>), color, notes?, scheduledTime?, createdAt, updatedAt, deletedAt?`
  - `dayMinutes` replaced the old `days` + `targetMinutes` (migrated in DB v14). **Do not reintroduce `days`/`targetMinutes`.**
- **RoutineLog**: `id, routineId, date, actualMinutes, completed, createdAt`
- **Activity**: `id, name, subjectId (nullable), dayMinutes, duration?, createsSession?, scheduledTime?, notes?, color, createdAt, updatedAt, deletedAt?`
- **ActivityLog**: `id, activityId, date, status ('completed'|'skipped'|'pending'), actualMinutes?, createdAt, sessionId?`
  - `sessionId` is set when an attendance confirmation creates a Session; untick reads it (do NOT re-derive from `createdAt`).
- **StudyArea / StudyReview**: FSRS spaced repetition. `ReviewRating = 1|2|3|4` (again, hard, good, easy). `fsrs-scheduler.ts`.
- **PendingSyncOp**: offline sync queue.

### 4.2 Dexie schema (`src/db/app-db.ts`)

DB name `study-app`. **16 versions** (v1→v16). Current tables: `categories, subjects, projects, sessions, progressLogs, marks, assignments, habits, habitLogs, streakDays, routines, routineLogs, activities, activityLogs, studyAreas, studyReviews, pendingSyncOps`. (Note: `tasks` and `hobbies`/`hobbySessions`/`scheduleEntries` tables were created in early versions but are orphaned/legacy — do not use them.)

**Rule:** any new table or index MUST bump the Dexie version and add an `.upgrade()` if existing rows need migration. Never reuse an old version number.

### 4.3 Soft deletes

All entities have optional `deletedAt`. **Session deletion MUST use soft-delete** (`db.sessions.update(id, { deletedAt: isoNow(), updatedAt: isoNow() })`), never hard delete. Undo clears `deletedAt` to `null`. Automatic sessions with `source === 'autoRoutine'` use `deletedAt` as a "pending confirmation" flag.

**All UI filters MUST exclude soft-deleted rows.** Two helpers:
- `isActiveSession(s)` in `src/lib/utils.ts` — `return !s.deletedAt`.
- `filterActive(arr)` in `src/lib/filterActive.ts` — generic `arr.filter(x => !x.deletedAt)`.

Use these; do not hand-roll `!s.deletedAt` everywhere (though inline is acceptable when the helper doesn't fit). **Missed soft-delete filters are the #1 recurring bug** (see §Pitfalls).

### 4.4 Session save helpers (`src/lib/save-study-session.ts`)

- `saveStudySession(input)` — builds + persists a Session, then calls `updateRoutineLogsForSession` and `updateStreakDayForSession`. Deterministic id via `sessionIdFor(startAt, subjectId, durationMinutes)`.
- `findOverlappingSessions(sessions, startAt, endAt, subjectId, excludeId?)` — overlap detection.
- `buildTodaySubjectBreakdown(sessions, subjects, todayStr, liveSubjectId?, liveMinutes?)` — per-subject today totals, optionally including the live in-flight session.

### 4.5 Routine + streak tracking (`src/lib/routine-tracker.ts`)

- `updateRoutineLogsForSession(session)` — auto-matches routines for the session's day+subject+project. **Only tags `routineId` when `session.source === 'autoRoutine'`** (H1). Explicit `session.routineId` is always logged toward.
- `revertRoutineLogsForSession(session)` — subtract on delete.
- `updateStreakDayForSession(session)` / `revertStreakDayForSession(session)` — recompute the StreakDay for the session's date from academic minutes vs `dailyTargetMinutes`.
- `recomputeStreakDaysForDates(dateKeys)` — bulk recompute after cascade soft-deletes.

---

## 5. Settings (`src/lib/settings-store.ts`)

localStorage key: `momentum-settings`. **This file is the single source of truth for the settings shape and defaults.** Do NOT duplicate defaults in SettingsPage (L1 bug).

```typescript
type Settings = {
  darkMode: boolean                    // default: true
  pomodoroEnabled: boolean             // default: true
  autoLogEnabled: boolean              // default: true
  pomodoroFocusMinutes: number         // default: 25
  pomodoroBreakMinutes: number         // default: 5
  pomodoroLongBreakMinutes: number     // default: 15
  pomodoroCyclesBeforeLongBreak: number// default: 4
  dailyTargetMinutes: number           // default: 120
  soundEnabled: boolean                // default: true
  maxActiveHabits: number              // default: 3
  defaultArchiveDays: number           // default: 66
  settingsUpdatedAt: string            // ISO, set on save
  devMode?: boolean                    // optional preview banner
}
```

`loadSettings()` merges stored over `DEFAULT_SETTINGS`; falls back to OS dark preference. `saveSettings()` stamps `settingsUpdatedAt`. `applyDarkMode(enabled)` toggles the `dark` class.

---

## 6. Features

### 6.1 Dashboard (`src/features/dashboard/Dashboard.tsx`)
- Stat cards (Today, This Week, Total, Sessions) — all filtered to `!deletedAt`.
- Study streak with weekly fire view. **Best streak** persisted in localStorage `momentum-best-streak`; display = max(computed longest, persisted record).
- Daily goal progress bar (default 120 min), green on completion.
- Study timer widget (see §6.8).
- 90-day heatmap, 5 intensity levels (slate → green-600).
- Recent sessions (last 8) with subject + duration + optional `focusTag` badge. **Multi-select checkboxes hidden by default; only shown after clicking "Select Sessions".**
- Achievements: dismissible celebratory card.
- **Widget position persistence**: toggling a widget off/on MUST restore its original position, not append to the end.
- **Widget layout system**: `use-dashboard-widgets.ts` supports `grid` and `freeform` modes. Freeform uses `Box { id, x, y, width, height, order }`, `resolveOverlaps`, `cascadeFreeformLayout`, `placeWithoutOverlap`. Storage key `momentum-dashboard-layout`. Widgets registered via `widget-registry.ts` (`registerWidget`, `window.Momentum.registerWidget`).

### 6.2 Subjects (CRUD) — `src/features/subjects/SubjectsPage.tsx`
Grid of cards (color dot, name, category). Add/Edit modal: name, category select (with "+ New" link to /categories), ColorPicker, routine checkboxes, weekly target. Warning banner if no categories. Delete with confirmation. Case-insensitive search. **Supports subject hierarchy** (parent/child).

### 6.3 Projects (CRUD) — `src/features/projects/ProjectsPage.tsx` + `ProjectDetailPage.tsx`
Grid with name, subject, description, goal minutes. Add/Edit modal. Delete with confirmation. Case-insensitive search by project + subject name. **Project totals MUST filter soft-deleted sessions** (H5).

### 6.4 Mark Tracker — `src/features/marks/MarksPage.tsx`
Table: Name, Subject, Score/Total, Weight, Weighted %, Date. Weighted average = `sum(score/total * weight) / sum(weight)`. Score color: green ≥80%, yellow ≥50%, red <50%. Academic subjects starred in select. Case-insensitive search.

### 6.5 Habit Tracker — `src/features/habits/HabitsPage.tsx`
Good/Bad sections. Cards: color dot, name, streak, last-7-day dots, today toggle. **Count mode** has a quick "Mark done" button; **tick mode** has a ✓ toggle. Select a habit for 90-day heatmap. Add/Edit modal with ColorPicker. **States**: Active, Potential, Finished (🎓, graduated — distinct from archive), Archived. **Finish suggestion** prompt at threshold. `maxActiveHabits` and `defaultArchiveDays` from settings.

### 6.6 Assignment Calendar — `src/features/calendar/CalendarPage.tsx`
Monthly grid with colored dots per type (homework=blue, assignment=purple, exam=red, other=slate). Upcoming list (next 30 days) with type badge + completed toggle. CRUD with type select + description. **Due badge**: nav item "Tasks" shows a red badge with count of assignments due within 24h.

### 6.7 Categories (CRUD) — `src/features/categories/CategoriesPage.tsx`
Academic/General sections. Add/Edit modal with name, scope, ColorPicker. Shows subject count per category. Delete warns about orphaned subjects. **Category delete MUST cascade soft-delete to subjects, projects, sessions, assignments, routineLogs, activityLogs in a single Dexie transaction, and recompute streak days** (H4, H6).

### 6.8 Pomodoro / Study Timer — `src/components/widgets/PomodoroTimer.tsx`
- **Two modes**: Simple (count-up) and Pomodoro (countdown focus/break). Pomodoro shown only when `settings.pomodoroEnabled`.
- **Simple mode**: Start → live elapsed → Stop & Save (logs a Session, min 1 min; <1 min rounds up to 1).
- **Safety guard**: auto-pauses after 12h continuous running, notifies user.
- **Background persistence**: timer MUST NOT pause on tab hide/focus loss. Uses wall-clock timestamps (`startedAt` in localStorage `momentum-timer-state`) and recomputes elapsed on resume. Crash-safety save on `visibilitychange`/`beforeunload` via `momentum-pending-session` (see `timer-persistence.ts`).
- **Pomodoro mode**: focus → auto-logs Session; short/long break phases; Start/Pause/Reset; cycle indicator dots; sound on phase change (when `soundEnabled`); inline config gear (disabled while running).
- **Subject selector**: required to start either mode.
- **Focus tags**: optional `focused | distracted | group | revision`.
- **Midnight split**: `splitSessionAtMidnight` in `timer-persistence.ts` splits a session crossing local midnight into two.

### 6.9 Schedule — `src/features/schedule/SchedulePage.tsx`
Combines **Routines** (self-directed study blocks) and **Activities** (recurring external commitments) into one page with Today tab + Weekly Plan grid. Routine cards, activity cards, catch-up detection (`findMissedDate`), weekly plan grid, cell edit modal, routine/activity edit modals.

### 6.10 Settings — `src/features/settings/SettingsPage.tsx`
Dark mode, pomodoro config, sound, daily target, auto-log, habit limits, backup/restore, reset, **Dev Build toggle** (Settings → General → "Dev Build" → persistent amber `DevBanner` on every page, undismissable while active; "Disable" calls `saveSettings({ ...settings, devMode: false })`).

### 6.11 Study (FSRS) — `src/features/study/`
`StudyPage` (overview), `ReviewSessionPage` (FSRS review), `ReviewLogPage` (log activity), `ExamConfigPage` (exam-mode compression). `fsrs-scheduler.ts`.

### 6.12 Groups — `src/features/groups/`
`GroupsPage` (leaderboards + cloud session sharing), `GroupDetailPage` (per-group sessions + member stats). Presence via `use-group-presence.ts`.

### 6.13 Reports — `src/features/reports/ReportsPage.tsx`
Overview stats + time-by-subject breakdown. Listens for `momentum:reports-period-1..4`, `momentum:reports-scope-all/academic/nonacademic` events.

### 6.14 AI Review — `src/features/reviews/AIReviewPage.tsx`
AI-powered study review and feedback.

---

## 7. UI Conventions

- **Shared components** (`src/components/ui/`): `ColorPicker` (12 presets + `<input type="color">`), `Card`/`CardHeader`/`CardTitle`, `Button`, `Modal`, `Spinner`, `EmptyState`, `Kbd`, `NumberInput`, `ErrorBoundary`, `DevBanner`, `OnboardingTour`, `ReloadPrompt`, `SyncBanner`, `FloatingTimerBanner`, `CommandPalette`, `UndoToast`, `Collapsible`.
- **CSS classes**: `btn-primary`, `btn-secondary`, `btn-danger`, `input`, `label`, `card`.
- **Dark mode**: `dark:` Tailwind prefix, class on `<html>`.
- **12 preset colors**: `#6366f1, #8b5cf6, #3b82f6, #06b6d4, #10b981, #f59e0b, #ef4444, #ec4899, #14b8a6, #f97316, #8b5cf6, #64748b`.
- **Number inputs**: use `<input type="number" min={1}>` (or the shared `NumberInput`). **NEVER use the `value === 1 ? '' : String(value)` pattern** — it prevents typing numbers starting with "1".
- **Note fields**: `<textarea rows={3}>`, no `maxLength`.
- **Touch targets**: small action buttons ≥44px effective (`min-h-[44px]`, `min-w-[44px]`, or padding) on mobile.
- **Skip link**: keyboard-accessible skip-to-content link in AppLayout.
- **Backdrop layers**: modals use `backdrop-blur-sm` + layered depth.
- **Shortcut display**: source registry uses `Cmd+...` canonically; renderer adapts per platform (`formatShortcutLabel` → `Ctrl` on Windows). Registry stays canonical.

---

## 8. Shortcuts (`src/lib/shortcuts.ts`)

- `SHORTCUTS` array is the single source of truth (100+ entries). Fields: `id, label, keys, category, description?, routes?, suppressInInput?`.
- `eventToShortcutKey(e)` normalizes a KeyboardEvent to a canonical key string.
- `getShortcutsForRoute(pathname)` filters by route.
- `formatShortcutLabel(keys)` adapts `Cmd+` → `⌘` (mac) / `Ctrl+` (win/linux).
- `isInputFocused()` — used to suppress shortcuts while typing.
- **The keydown handler lives in `AppLayout.tsx`** and dispatches from the registry. **Every shortcut declared in the registry MUST have a working dispatch** — a declared-but-unwired shortcut is a bug (help overlay shows it but pressing it does nothing). Page-specific shortcuts dispatch custom events (e.g. `momentum:log-time`, `momentum:timer-toggle`, `momentum:timer-stop-save`, `momentum:marks-add`, `momentum:calendar-add`, `momentum:subjects-add`) that pages listen for.
- **Input suppression**: when a text input/textarea is focused, global shortcuts (`d`, `s`, `p`, `n`, etc.) MUST NOT fire. `Esc` and `Cmd+K`/`Ctrl+K` remain allowed.

---

## 9. Session Editing & Log-Time

**Edit-session modal** MUST include: Minutes (number, min 1), Date (date input), Start time (time input, required, defaults to original `startAt`), End time (time input, optional — if omitted, computed as start + duration), Subject (select), Project (optional select, **hidden entirely when the selected subject has no projects**), Note (textarea rows 3).

`saveEditLog()` MUST derive `durationMinutes` from start/end when both provided, and MUST call `revertStreakDayForSession(prevSession)` + `updateStreakDayForSession(nextSession)` to keep streak totals consistent across date changes. MUST persist `projectId` and `note`; undo/redo MUST restore those fields too.

**Log-time modal** includes optional start/end time fields. When both provided, duration = difference; when only start, end = start + duration. Persisted in `dash-log-form` sessionStorage, reset on submit.

---

## 10. Common Pitfalls, Stalls & Misimplementations

These are the recurring failure modes. Read before editing. **If you hit one, you are not blocked — you are in a known trap; get out of it.**

### 10.1 Soft-delete filtering (the #1 recurring bug)
- **Symptom**: totals, streaks, project minutes, recent-session counts, subject breakdowns include deleted sessions.
- **Fix**: every aggregate MUST filter `!s.deletedAt` (or use `isActiveSession`/`filterActive`). Check: project totals (H5), `buildTodaySubjectBreakdown` (M11), recent-session "Showing X of Y" (regression #3), streak days, dashboard stat cards.
- **Stall trap**: "why is the count wrong?" → check the filter first, not the data.

### 10.2 Timer state / wall-clock (background persistence)
- **Symptom**: timer pauses when tab hidden, or elapsed time is wrong after returning.
- **Fix**: timer MUST derive elapsed from wall clock `(Date.now() - startedAt)`, never from a `setInterval` counter that stops when the tab is hidden. State in localStorage `momentum-timer-state`. Crash-safety via `momentum-pending-session` on `visibilitychange`/`beforeunload`.
- **Stall trap**: "timer stopped while I was in another tab" → the interval-based counter is the bug; switch to wall-clock derivation.

### 10.3 Pomodoro phase transitions (phantom sessions)
- **Symptom**: a focus session is saved even when nothing was studied, or the phase-change handler re-fires and saves duplicates.
- **Fix**: derive tick from wall clock `(Date.now() - pomStartedAt)/1000`; use a `transitionedRef` so a transition fires ONCE per render commit; clear `pomIntervalRef.current` on every phase change. (C1 in bugfix-plan.)
- **Stall trap**: "it saved a session I didn't study" → re-entrancy in the phase-change handler.

### 10.4 QuickTimer scope leaks into academic totals
- **Symptom**: a QuickTimer running on a non-academic subject still adds minutes to the academic "Today" total.
- **Fix**: `getLiveTimerSeconds` must resolve the timer's subject scope via `getSessionScope` and only include live seconds when the source is academic. (C2.)
- **Stall trap**: "Today total is too high" → check whether a live timer is leaking across scopes.

### 10.5 Subject/project/category delete cascades
- **Symptom**: deleting a category or subject leaves orphaned projects/sessions/assignments, or streak days go stale.
- **Fix**: cascade soft-delete to all dependent rows in a single Dexie transaction, then `recomputeStreakDaysForDates`. Undo must restore everything. (H4, H6.)
- **Stall trap**: "I deleted a subject but its sessions still show up" → cascade missing.

### 10.6 Routine tagging of arbitrary sessions
- **Symptom**: manually-created sessions get silently assigned a `routineId`.
- **Fix**: only set `routineId` when `session.source === 'autoRoutine'`; never overwrite an existing `routineId`. (H1.)

### 10.7 Activity untick uses wrong lookup
- **Symptom**: unticking an activity deletes the wrong session or fails.
- **Fix**: read `removedLog.sessionId` (persisted at creation), never re-derive from `createdAt`. (H2.)

### 10.8 FAB events race page mount
- **Symptom**: clicking a FAB "Add" action does nothing because the page isn't mounted yet.
- **Fix**: replace `setTimeout(dispatchEvent, 0)` with `navigate(route, { state: { openAdd: true } })`; the page reads the flag in a mount effect and clears it. (M1.)

### 10.9 Union-typed fields widened to `string`
- **Symptom**: `focusTag` (or `TaskCategory`, `HabitMode`, `ReviewRating`) becomes `string | null` in form state, breaking type safety and comparisons.
- **Fix**: keep the strict union type in form state and save handlers. (Spec §15.)

### 10.10 NumberInput / typing numbers starting with "1"
- **Symptom**: can't type `10`, `15`, `120` — the field clears or clamps.
- **Fix**: never use `value === 1 ? '' : String(value)`. Use `<input type="number" min={1}>` or shared `NumberInput`. On empty blur, don't clamp to `min`; keep empty and validate on submit. (L7.)

### 10.11 JSX parent-wrapper regressions
- **Symptom**: after merging/refactoring dashboard widgets, JSX parent-element errors or broken layout.
- **Fix**: re-check parent wrappers (e.g. the `Card` wrapper around the `today` widget) before build. (Spec §15.)

### 10.12 Stale-tag edits
- **Symptom**: an edit lands in the wrong place because the file changed since the last read.
- **Fix**: re-ground on the latest file hash before every edit. Dashboard files are large; stale-tag inserts can land inside JSX blocks. (Spec §15.)

### 10.13 Undo stack corruption
- **Symptom**: undo/redo does the wrong thing or silently drops actions.
- **Fix**: `use-undo.tsx` guards concurrent pushes with `isPushing` and surfaces "Action in progress — try again". Pushing clears the redo stack. MAX_DEPTH 50. (M12.)

### 10.14 Settings defaults duplicated
- **Symptom**: SettingsPage has its own copy of defaults that drifts from `settings-store.ts`.
- **Fix**: import from `settings-store.ts`; never redefine. (L1.)

### 10.15 Streak milestone / best-streak inconsistency
- **Symptom**: current streak and best streak disagree, or milestones show wrong values.
- **Fix**: `STREAK_MILESTONES` centralized in `utils.ts`; best streak = max(computed, persisted `momentum-best-streak`). (L2, L3.)

### 10.16 Subject picker with deleted parents
- **Symptom**: child subjects appear under a deleted parent, or the picker shows orphans.
- **Fix**: filter out children whose parent is deleted (or filter them cleanly). (L4.)

### 10.17 Dexie version bumps
- **Symptom**: adding a table/index without bumping the version → Dexie throws or data is lost.
- **Fix**: always bump the version and add `.upgrade()` for migrations. Never reuse a version number. (Spec §4.2.)

### 10.18 `flushPendingDirtyTables()` during render
- **Symptom**: side effects during render cause double-fires or warnings.
- **Fix**: move into a `useEffect` or prefix with `void`. (M8.)

### 10.19 `loadPrefs` wipes nav prefs on version bump
- **Symptom**: nav order/visibility resets unexpectedly.
- **Fix**: don't bump `CURRENT_PREFS_VERSION` casually; if the version differs but no schema-affecting change, treat as passthrough. (M9.)

### 10.20 Routine save doesn't create a Session
- **Symptom**: logging routine minutes doesn't create a Session, so it doesn't count toward study time.
- **Fix**: `RoutinePage.saveLogMinutes` MUST create a corresponding Session like TodayChecklist does (`startAt = now - mins*60_000`, `endAt = now`, `source = 'manual'`, `subjectId`, `projectId`). (M10.)

### 10.21 Non-awaited cloud deletes
- **Symptom**: bulk session delete leaves cloud rows behind.
- **Fix**: `await Promise.all(targets.map(s => syncSessionDelete(s.id)))`. (M6.)

### 10.22 Auto-log widget shows all soft-deleted autoRoutine sessions
- **Symptom**: the auto-log widget lists sessions that were already dismissed.
- **Fix**: filter to `pendingConfirmation === true` AND within 24h; add "Dismiss all". (M7.)

### 10.23 Freeform widget layout
- **Symptom**: widgets jump to wrong positions, or saved x/y get overwritten on first switch.
- **Fix**: keep inline style until state commit lands (L9); don't overwrite saved x/y on first switch (L10). `resolveOverlaps`/`cascadeFreeformLayout`/`placeWithoutOverlap` in `use-dashboard-widgets.ts`.

### 10.24 Timer subject fallback
- **Symptom**: QuickTimer silently falls back to `data.subjects[0]` when the configured subject was deleted.
- **Fix**: surface an alert and do NOT save a session; offer reassign. (H3.)

### 10.25 `changeSubject` over-reports / stale seconds
- **Symptom**: switching subject mid-timer over-reports minutes or shows stale elapsed.
- **Fix**: cap at `cfg.focusMinutes * 60_000` (M2); compute simple-mode elapsed from `(Date.now() - simpleStartedAt)/1000 + simplePausedOffset/1000` (M5).

### 10.26 `saveSessionWithMidnightCheck` allows empty subjectId
- **Symptom**: a session with no subject is saved.
- **Fix**: early return when `actualSubjectId` is empty. (M3.)

### 10.27 `splitSessionAtMidnight` floor mismatch
- **Symptom**: split sessions have wrong durations.
- **Fix**: use actual ms for both seconds and `durationMinutes`; reuse `Math.max(1, Math.round(...))` only for the ID. (M4.)

### 10.28 Empty project dropdown
- **Symptom**: a project dropdown renders empty when the subject has no projects.
- **Fix**: hide the dropdown entirely when the selected subject has zero projects. (Regression #6.)

### 10.29 Duplicate widget entries / copy
- **Symptom**: "Upcoming Assignments" appears twice in the widget customise list, or daily-goal copy repeats.
- **Fix**: dedupe widget list (regression #5); don't repeat daily-goal text in the Streak & Goal widget (regression #7).

### 10.30 Modal drag-to-dismiss
- **Symptom**: dragging inside a modal dismisses it.
- **Fix**: rely on parent's `onMouseDown` only; remove inner handler. (L6.)

---

## 11. Regression Checklist — MUST pass before deployment

1. **Timer background persistence** — start timer, switch tabs/windows, wait ≥10s, return. Elapsed MUST reflect real wall-clock time, not paused.
2. **Sub-subject project overwrite** — in Log Study Time, select a sub-subject then a project. The visible subject MUST remain the sub-subject, not snap back to parent.
3. **Recent sessions soft-delete filtering** — soft-delete a session; "Showing X of Y" MUST exclude it from `Y`.
4. **Recent sessions selection affordance** — checkboxes hidden until "Select Sessions" clicked.
5. **Duplicate upcoming assignments** — appears only once in widget customise list.
6. **Empty project dropdown** — hidden when subject has zero projects.
7. **Duplicate daily goal text** — Streak & Goal widget MUST NOT repeat the Today card's copy.
8. **Widget position persistence** — toggle off/on returns to original position.
9. **Keyboard shortcut suppression in inputs** — typing `d`/`s`/`p`/`n` in an input does nothing but type; `Esc` and `Cmd+K`/`Ctrl+K` still work.
10. **Shortcut registry consistency** — registry uses `Cmd+...` canonically; render-time adaptation only.
11. **Tests and type-check** — `npx tsc --noEmit` and `npx vitest run` MUST pass.

---

## 12. Pending Bugs (open, not yet closed)

Tracked in `momentum/.bugfix-plan.md` (CRITICAL/HIGH/MEDIUM/LOW with fix sketches). When you close one, update that file AND this section.

**Closed on 2026-08-13** (see .bugfix-plan.md for STATUS comments):
- C2, H2, M1, M7, L3, L11, L12

**Closed earlier** (no items re-opened):
- C1, H1, H3, H4, H5, H6, M2, M4, M6, M8, M9, M10, M11, M12, L1, L2, L7, L8, L9, L10

Open items (from bugfix-plan + spec):
- **L4** Subject picker hides children whose parent is deleted (or filter them out cleanly)
- **L6** Modal drag-to-dismiss: rely on parent's `onMouseDown` only; remove inner handler

**Disputed / stale-spec:** L5 (project dropdown) — contradicts Regression Checklist §6; current behavior is correct.

Feature-level open items (from earlier spec, still valid):
- Right-click context actions where appropriate (partially implemented: Dashboard sessions/routines, not Calendar/Marks/Subjects)
- Notifications audit: existing service works correctly for safety/phase/save; no bugs found
- Merge Today + This Week + Today's Schedule widgets into one "Today" widget
- Dashboard widgets: free resizing with min/max (freeform mode has this; grid mode still uses S/M/L presets)
- Remove autolog widget from dashboard; convert to popup/modal (autolog widget is already orphaned — not in `DASHBOARD_WIDGETS_METADATA`, so it only renders if a user has it in their persisted layout)
- Remove log-time widget (redundant) — already done; log-time is now a modal triggered by FAB / Cmd+L / N shortcut

**Closed feature items:** discard-session timer leak, focus tags in study timer, notes before start, activities count toward study time, activity confirmation banner — all already implemented (verified in code).

---

## 13. Build & Deployment

```bash
cd momentum && npm install && npm run dev     # dev server on :5173
cd momentum && npm run build                  # production build
cd momentum && npx tsc --noEmit               # type-check only
cd momentum && npx vitest run                 # tests
```

**Deployment**:
- Canonical repo: `https://github.com/momentum-study/momentum.git` (remote `org`).
- Canonical live URL: `https://momentum-study.github.io/momentum/`.
- `origin` = personal fork `leightonmascord/momentum` (development only).
- Release flow:
  ```bash
  git push org main
  npm run deploy
  ```
- If README/comments mention `leightonmascord.github.io/momentum`, that is stale — correct to `momentum-study.github.io/momentum`.

---

## 14. Maintenance Protocol (self-updating)

This file is designed to evolve. **Every instance that makes a durable change to the codebase MUST update this file in the same change.** This is what keeps "read specs for momentum" sufficient for the next instance.

### 14.1 When to update
Update this file when you:
- Add/remove/rename a **route** (§3) or **nav item** (§3).
- Add/remove/rename a **domain type** or **field** (§4.1).
- Bump the **Dexie version** or change the **schema** (§4.2).
- Add/remove a **settings field** or change a **default** (§5).
- Add/remove a **feature** or change its behavior (§6).
- Add/remove a **shortcut** (§8).
- Change a **UI convention** (§7).
- Discover a **new pitfall** or close an old one (§10, §12).
- Change the **provider hierarchy**, **data flow**, or **sync** (§1).
- Change **build/deploy** (§13).

### 14.2 How to update
- Keep sections numbered and stable. Append, don't rewrite, unless a section is factually wrong.
- When you close a bug, move it from §12 (Pending) to §10 (Pitfalls) as a "fixed" note, or delete it if it's no longer relevant. Update `.bugfix-plan.md` too.
- When you add a pitfall, write it as: **Symptom** → **Fix** → **Stall trap** (the wrong conclusion a future instance might jump to). This format is what saves time.
- Keep the "Stale-spec warning" callouts when you correct something that was previously wrong — they prevent future instances from reintroducing the old behavior.
- If you change a default or a type, update the inline code blocks in §4/§5 to match exactly.

### 14.3 Grounding rule (repeated)
The code is the source of truth. If this file and the code disagree, the code wins — and you MUST update this file to match. Never trust a stale spec over the actual implementation. When you read the code and find this file wrong, fix the file, don't work around the code.

### 14.4 Version stamp
When you make a substantive update, bump the `SPEC_VERSION` marker below so instances can tell at a glance whether the file is current.

**SPEC_VERSION: 3** — 2026-08-13 bug-fix sweep: closed C2, H2, M1, M7, L3, L11, L12; updated §12 to reflect current state.
