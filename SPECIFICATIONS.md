# Momentum — Specifications

> All design decisions and constraints for the Momentum study app. Any build that violates these specs must be fixed before deployment.

---

## 1. Architecture

- **Local-first PWA** — all data stored in IndexedDB via Dexie. No server, no accounts.
- **Stack**: React 18, TypeScript, Vite, Tailwind CSS (class-based dark mode), Dexie, React Router, date-fns
- **Dark mode**: On by default. Class `dark` on `<html>`, toggled by Settings.
- **Data provider**: Single `DataProvider` context wraps the entire app. `useData()` returns `{ data, isLoading, loadData }`.

## 2. App Name

**Momentum** — branded in the sidebar and `<title>`.

## 3. Routes (19)

| Path | Page | Description |
|------|------|-------------|
| `/` | Dashboard | Stats, streak, daily goal, timer widget, heatmap, recent sessions |
| `/subjects` | SubjectsPage | CRUD subjects with category, color, routine, weekly target |
| `/projects` | ProjectsPage | CRUD projects with subject, description, goal minutes |
| `/projects/:id` | ProjectDetailPage | Per-project sessions, assignments, and progress |
| `/routines` | RoutinePage | Daily routine scheduler with weekly progress |
| `/marks` | MarksPage | Mark tracker for academic subjects with weighted average |
| `/habits` | HabitsPage | Good/bad habit tracker with streaks, 7-day view, 90-day heatmap |
| `/hobbies` | HobbiesPage | Non-academic activity tracker |
| `/study` | StudyPage | Spaced-repetition area overview |
| `/study/review` | ReviewSessionPage | FSRS review session for study areas |
| `/study/log` | ReviewLogPage | Log study area activity |
| `/study/exam` | ExamConfigPage | Configure exam-mode compression |
| `/groups` | GroupsPage | Group leaderboards and cloud session sharing |
| `/groups/:id` | GroupDetailPage | Per-group session list and member stats |
| `/calendar` | CalendarPage | Monthly calendar with assignments + upcoming list |
| `/categories` | CategoriesPage | CRUD categories (academic/general) with color picker |
| `/reports` | ReportsPage | Overview stats and time-by-subject breakdown |
| `/reviews` | AIReviewPage | AI-powered study review and feedback |
| `/settings` | SettingsPage | Dark mode, pomodoro config, daily target, sound, reset |

## 4. Data Model

### Core Entities (v1)

| Entity | Key Fields | Dexie Indexes |
|--------|-----------|---------------|
| Category | id, name, scope (`academic`/`nonAcademic`), color | `id, scope, name` |
| Subject | id, categoryId, name, color, routine? (0-6 days), weeklyTargetMinutes? | `id, categoryId, name` |
| Project | id, subjectId, name, description?, goalMinutes? | `id, subjectId, name` |
| Task | id, projectId, name, orderIndex, done | `id, projectId, orderIndex` |
| Session | id, subjectId, projectId?, assignmentId?, startAt, endAt, durationMinutes, durationSeconds?, note?, focusTag?, source, createdAt, updatedAt, deletedAt? | `id, subjectId, projectId, startAt` |
| ProgressLog | id, subjectId, loggedAt, value, unit? | `id, subjectId, loggedAt` |

### Extended Entities (v2)

| Entity | Key Fields | Dexie Indexes |
|--------|-----------|---------------|
| Mark | id, subjectId, name, score, total, weight, date | `id, subjectId, date` |
| Assignment | id, subjectId, title, dueDate, type, completed | `id, subjectId, dueDate, completed` |
| Habit | id, name, kind (`good`/`bad`), color | `id, kind` |
| HabitLog | id, habitId, date (YYYY-MM-DD), note?, focusTag? | `id, habitId, date` |
| StreakDay | id (YYYY-MM-DD), totalMinutes, goalMet | `id, totalMinutes, goalMet` |

### Soft Deletes

All entities have an optional `deletedAt` field. Session deletion MUST use soft-delete (`db.sessions.update(id, { deletedAt: isoNow(), updatedAt: isoNow() })`), never hard delete (`db.sessions.delete(id)`). The undo path clears `deletedAt` to `null`. All UI filters (streak, totals, widgets, counters) MUST filter with `!s.deletedAt` — centralised via a helper `isActiveSession(s)` in `lib/utils.ts`. Automatic sessions with `source === 'autoRoutine'` use `deletedAt` as a "pending confirmation" flag.

### Session Save Helpers

- `saveStudySession()` in `src/lib/save-study-session.ts` is the shared helper for building and persisting a study session, updating routine logs, and updating streak days.
- `findOverlappingSessions()` detects subject-overlap conflicts for a proposed session time range.
- `buildTodaySubjectBreakdown()` computes today's per-subject minute totals, optionally including the live in-flight session.

## 5. Features

### 5.1 Dashboard
- **Stat cards**: Today, This Week, Total, Sessions count (all filtered to `!deletedAt`)
- **Study Streak**: Consecutive days with study activity. Weekly view with fire emoji.
  - **Best Streak**: Persisted in localStorage (`momentum-best-streak`). Display shows the maximum of the computed longest streak and the persisted record value, updated automatically.
- **Daily Goal**: Progress bar toward configurable daily target (default 120 min). Green on completion.
- **Study Timer Widget**: (see §5.8)
- **Study Heatmap**: 90-day grid, 5 intensity levels (slate → green-600).
- **Recent Sessions**: Last 8 sessions with subject name and duration. Sessions may display an optional `focusTag` badge (`focused`, `distracted`, `group`, `revision`). Multi-select checkboxes are hidden by default and only shown after clicking "Select Sessions".
- **Achievements**: Lightweight milestone unlocks (study time, streaks, early-bird/night-owl, etc.) appear as a dismissible celebratory card at the top of the dashboard.
- **Widget Position Persistence**: Toggling a widget off/on MUST restore it to its original configured position rather than appending it to the end of the grid.

### 5.2 Subjects (CRUD)
- Grid of subject cards with color dot, name, category
- Add/Edit modal: name, category select (with "+ New" link to /categories), **ColorPicker** (presets + custom color wheel), routine checkboxes, weekly target
- Warning banner if no categories exist yet
- Delete with confirmation
- **Search**: Case-insensitive search input filters subjects by name

### 5.3 Projects (CRUD)
- Grid with name, subject, description, goal minutes
- Add/Edit modal with subject select, description, goal minutes
- Delete with confirmation
- **Search**: Case-insensitive search input filters by project name and subject name

### 5.4 Mark Tracker
- Table: Name, Subject, Score/Total, Weight, Weighted %, Date
- Summary: total marks, weighted average = `sum(score/total * weight) / sum(weight)`
- Score color: green ≥80%, yellow ≥50%, red <50%
- Academic subjects starred in select
- **Search**: Case-insensitive search input filters by mark name and subject name

### 5.5 Habit Tracker
- Good Habits / Bad Habits sections
- Habit cards: color dot, name, streak, last-7-day dots, today toggle
- **Mark as completed**: Quick "Mark done" button on count-mode habit cards. For daily check-in mode (tick mode), a ✓ button toggles today's completion on/off.
- Select a habit to view 90-day calendar heatmap
- Add/Edit modal with **ColorPicker**
- **Tracking modes**: "Count" (log every occurrence) or "Daily check-in" (mark once per day, with option to undo)
- **Habit states**: Active, Potential (parked for later), Finished (permanently graduated), Archived
- **Finish habit**: A habit can be permanently finished/graduated when it's second nature. This is distinct from archive: finished habits move to a "Finished Habits" section with a 🎓 icon and can be restored.
- **Finish suggestion**: When a habit reaches its suggested day threshold, the card shows a friendly prompt: "this may be second nature now. Want to finish it?"

### 5.6 Assignment Calendar
- Monthly grid with colored dots per type (homework=blue, assignment=purple, exam=red, other=slate)
- Upcoming list (next 30 days) with type badge, completed toggle
- CRUD with type select and description
- **Due badge**: The navigation item for Tasks shows a small red badge with the count of due assignments within the next 24 hours.

### 5.7 Categories (CRUD)
- Academic / General sections
- Add/Edit modal with name, scope, **ColorPicker**
- Shows subject count per category
- Delete warns about orphaned subjects

### 5.8 Pomodoro / Study Timer Widget
- **Two modes**: Simple (count-up) and Pomodoro (countdown focus/break)
- **Mode toggle**: Simple always available; Pomodoro shown only when `settings.pomodoroEnabled = true`
- **Simple mode**: Start → live elapsed display → Stop & Save (logs a Session, minimum 1 min; durations < 1 min round up to 1 min)
- **Safety guard**: Timer auto-pauses after 12 hours of continuous running and notifies the user.
- **Background persistence**: Timer MUST NOT pause when the tab is hidden or the window loses focus. The timer uses wall-clock timestamps (`startedAt` in localStorage) and recomputes elapsed time on resume. Crash-safety save on `visibilitychange` and `beforeunload` is preserved.
- **Pomodoro mode**:
  - Focus phase → auto-logs a Session on completion
  - Short break / Long break phases (configurable cycles before long break)
  - Start / Pause / Reset controls
  - Cycle indicator dots (filled = completed focus blocks)
  - Sound notification on phase change (when `settings.soundEnabled`)
  - **Inline config (⚙️ gear icon)**: Edit Focus, Short Break, Long Break, Cycles, Sound directly on the timer card. Disabled while timer is running. Changes persist to localStorage and sync with the Settings page.
- **Subject selector**: Required to start either mode
- **Focus tags**: Manual logs and timer-created sessions may include an optional focus tag (`focused`, `distracted`, `group`, `revision`).

### 5.9 Settings
- Dark mode toggle (on by default)
- Pomodoro: enable toggle, focus minutes, short break, long break, cycles before long break
- Sound notification toggle
- Daily target minutes
- Reset settings button
- **Dev Build toggle**: Settings → General → "Dev Build". When enabled, the app shows a persistent preview banner on every page.

## 6. Settings Storage

localStorage key: `momentum-settings`

```typescript
type Settings = {
  darkMode: boolean                           // default: true
  pomodoroEnabled: boolean                    // default: true
  pomodoroFocusMinutes: number                // default: 25
  pomodoroBreakMinutes: number                // default: 5
  pomodoroLongBreakMinutes: number            // default: 15
  pomodoroCyclesBeforeLongBreak: number       // default: 4
  dailyTargetMinutes: number                  // default: 120
  soundEnabled: boolean                       // default: true
  devMode?: boolean                           // optional preview banner
}
```

## 7. UI Conventions

- **Shared components**: `ColorPicker` (presets + `<input type="color">`), `Card`, `Button`, `Modal`, `Spinner`, `EmptyState`, `Kbd`
- **CSS classes**: `btn-primary`, `btn-secondary`, `btn-danger`, `input`, `label`, `card`
- **Dark mode**: `dark:` Tailwind prefix, class on `<html>`
- **12 preset colors**: `#6366f1, #8b5cf6, #3b82f6, #06b6d4, #10b981, #f59e0b, #ef4444, #ec4899, #14b8a6, #f97316, #8b5cf6, #64748b`
- **Custom color**: `<input type="color">` for infinite customisable colours on all color pickers
- **Number inputs**: Use `<input type="number" min={1}>` for duration fields. NEVER use the `value === 1 ? '' : String(value)` pattern — it prevents typing numbers starting with "1".
- **Note fields**: Use `<textarea rows={3}>` for session notes, not single-line `<input>`. No `maxLength` constraint.
- **Touch targets**: Small action buttons should use at least 44px effective touch targets (`min-h-[44px]`, `min-w-[44px]`, or equivalent padding) on mobile.
- **Skip link**: App layout includes a keyboard-accessible skip-to-content link.
- **Backdrop layers**: Modals use `backdrop-blur-sm` and layered depth styling rather than plain flat surfaces.
- **Shortcut display**: The keyboard shortcut guide MUST use `Cmd` as the canonical string in the source registry; the renderer MAY adapt it per platform (e.g., display `Ctrl` on Windows) but the source of truth remains `Cmd+...`.

## 8. Session Editing

The edit-session modal MUST include:
- **Minutes** (number input, min 1)
- **Date** (date input)
- **Start time** (time input, required — defaults to original `startAt` time)
- **End time** (time input, optional — if omitted, computed as start + duration)
- **Subject** (select)
- **Project** (optional select, populated when subject has projects; the dropdown MUST be hidden entirely when the selected subject has no projects)
- **Note** (textarea, rows 3)

`saveEditLog()` MUST derive `durationMinutes` from the difference between start and end times when both are provided, and MUST call `revertStreakDayForSession(prevSession)` + `updateStreakDayForSession(nextSession)` to keep streak totals consistent across date changes. The session record MUST also persist `projectId` and `note` updates, and undo/redo MUST restore those fields too.

The log-time modal MUST include optional start and end time fields. When both are provided, duration is computed from the difference; when only start is provided, end is computed from start + duration. The new fields are persisted in the `dash-log-form` sessionStorage entry and reset on submit.

## 9. DB Schema Versions

- **v1**: categories, subjects, projects, tasks, sessions, progressLogs
- **v2**: + marks, assignments, habits, habitLogs, streakDays

## 10. Build

```bash
cd momentum && npm install && npm run dev     # dev server on :5173
cd momentum && npm run build                  # production build
cd momentum && npx tsc --noEmit               # type-check only
cd momentum && npx vitest run                 # tests
```

## 11. Deployment

- **Canonical repo**: `https://github.com/momentum-study/momentum.git`
- **Canonical live URL**: `https://momentum-study.github.io/momentum/`
- The local repo may also have a personal-fork remote (`origin`) pointing at `leightonmascord/momentum`, but **future pushes and deployments must target `momentum-study`**.
- Recommended remote names:
  - `org` → `https://github.com/momentum-study/momentum.git`
  - `origin` → personal fork (optional)
- Release flow:

```bash
git push org main
npm run deploy
```

- If README or comments mention `leightonmascord.github.io/momentum`, that is stale and should be corrected to `momentum-study.github.io/momentum`.

## 12. Dev Build / Preview Mode

Dev mode is a per-session toggle in Settings → General → Dev Build. When enabled, a sticky amber banner appears at the top of every page with "Dev Build — Preview Mode" and a "Testing Done — Push to Global" button. The banner is undismissable while dev mode is active.

- **Storage**: `devMode?: boolean` in `momentum-settings`
- **Banner component**: `src/components/ui/DevBanner.tsx`
- **Push action**: Best-effort `POST /__dev_push__` to the dev server; the actual deploy is performed out-of-band by the developer.
- **Disable**: A "Disable" button on the banner calls `saveSettings({ ...settings, devMode: false })` and dismisses the banner immediately.

## 13. Versioning & Rollback

- The build should expose a simple `VERSION` string constant in source (pending implementation) so the current build can be identified by users and developers.
- **Rollback procedure** (manual): if a release breaks production, revert the breaking commit(s), push to `org main`, and redeploy.
- Future improvement: show the current `VERSION` in Settings → Dev Build and on the preview banner.

## 14. Regression Checklist — MUST pass before deployment

The following issues have been fixed in code and MUST be explicitly checked before every production deploy:

1. **Timer background persistence** — Start the study timer, switch tabs/windows, wait at least 10 seconds, return. The elapsed time MUST reflect real wall-clock time and MUST NOT have paused.
2. **Sub-subject project overwrite** — In the Log Study Time modal, select a sub-subject, then select a project. The visible subject selection MUST remain the chosen sub-subject; it MUST NOT snap back to the parent subject.
3. **Recent sessions soft-delete filtering** — Soft-delete a session. The "Showing X of Y sessions" stat MUST exclude the deleted row from `Y`.
4. **Recent sessions selection affordance** — Checkboxes MUST be hidden until the user clicks "Select Sessions". The list MUST NOT look like it is always in bulk-edit mode.
5. **Duplicate upcoming assignments in customise modal** — "Upcoming Assignments" MUST appear only once in the widget customise list.
6. **Empty project dropdown** — In the log-time modal and timer widget, if a subject has zero projects, the project dropdown MUST NOT render.
7. **Duplicate daily goal text** — The Streak & Goal widget MUST NOT repeat the same "X remaining" / daily-goal copy already shown in the main Today stats card.
8. **Widget position persistence** — Toggle a widget off, then back on. It MUST return to its original configured position rather than moving to the end.
9. **Keyboard shortcut suppression in inputs** — Focus any text input or textarea. Type letters that correspond to global shortcuts (`d`, `s`, `p`, `n`, etc.). No navigation or shortcut action may fire; only the text input should change. `Esc` and `Cmd+K` / `Ctrl+K` remain allowed.
10. **Shortcut registry consistency** — The source shortcut registry MUST use `Cmd+...` consistently. Platform-specific display adaptation MAY happen at render time, but the registry itself MUST stay canonical.
11. **Tests and type-check** — `npx tsc --noEmit` and `npx vitest run` MUST pass before deployment.

### Pending bugs still to fix (not yet closed)

These are documented known issues and are NOT yet implemented:

- Right-click context actions where appropriate
- Notifications audit/fix (was attempted before, verify)
- Discard session: total time timer keeps running even when study timer is stopped
- Focus quality tags in regular study timer (not just manual log)
- Notes editable on study timer before starting
- Activities count toward study time for that day
- Activity confirmation banner/popup for easy logging
- Merge Today + This Week + Today's Schedule widgets into one "Today" widget
- Dashboard widgets: free resizing with min/max (replace S/M/L presets)
- Remove autolog widget from dashboard; convert to popup/modal
- Remove log-time widget (redundant)

## 15. Implementation Notes / Common Pitfalls

- **Do not widen union-typed fields to plain strings in editing UIs.** Example: `Session.focusTag` is a strict union (`'focused' | 'distracted' | 'group' | 'revision' | undefined`), so modal/editor form state and save handlers must use the same union type rather than `string | null`.
- **When replacing or refactoring JSX blocks, re-check parent wrappers before build/deploy.** Example: merging dashboard widgets temporarily dropped the `Card` wrapper around the `today` widget, which caused JSX parent-element errors and broken layout.
- **When patching files repeatedly, re-ground on the latest file hash before editing.** Dashboard edits in this repo are large enough that stale-tag inserts can land inside JSX blocks if not re-read first.
