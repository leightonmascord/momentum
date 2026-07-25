/**
 * Central keyboard shortcut registry.
 * Single source of truth for all shortcuts — powers the help overlay,
 * context menu hints, per-page toasts, tip of the day, and inline Kbd UI.
 */

export interface Shortcut {
  /** Unique identifier for this shortcut */
  id: string
  /** Human-readable label */
  label: string
  /** Key combination (e.g. 'Cmd+K', 'Ctrl+Shift+T', '?') */
  keys: string
  /** Category for grouping in help overlay */
  category: 'global' | 'dashboard' | 'subjects' | 'habits' | 'marks' | 'calendar' | 'reports' | 'timer'
  /** Optional description shown in help overlay */
  description?: string
  /** Route path(s) where this shortcut is active. Empty = global. */
  routes?: string[]
  /** Whether this shortcut is suppressed when an input is focused */
  suppressInInput?: boolean
}

export const SHORTCUTS: Shortcut[] = [
  // ── Global ──
  { id: 'command-palette', label: 'Command Palette', keys: 'Cmd+K', category: 'global', description: 'Search pages, subjects, and commands', suppressInInput: false },
  { id: 'log-time', label: 'Log Study Time', keys: 'Cmd+L', category: 'global', description: 'Open the log study time modal' },
  { id: 'start-timer', label: 'Start/Pause Timer', keys: 'Cmd+Shift+T', category: 'global', description: 'Start or pause the study timer' },
  { id: 'stop-timer', label: 'Stop & Save Timer', keys: 'Cmd+Shift+S', category: 'global', description: 'Stop and save the current timer session' },
  { id: 'discard-session', label: 'Discard Session', keys: 'Cmd+Shift+Del', category: 'global', description: 'Discard the current timer session without saving' },
  { id: 'undo', label: 'Undo', keys: 'Cmd+Z', category: 'global', description: 'Undo last action' },
  { id: 'redo', label: 'Redo', keys: 'Cmd+Shift+Z', category: 'global', description: 'Redo last undone action' },
  { id: 'help', label: 'Keyboard Shortcuts', keys: '?', category: 'global', description: 'Open keyboard shortcut help overlay', suppressInInput: true },
  { id: 'help-alt', label: 'Keyboard Shortcuts', keys: 'Cmd+/', category: 'global', description: 'Open keyboard shortcut help overlay' },
  { id: 'replay-tour', label: 'Replay onboarding tour', keys: 'Cmd+Shift+I', category: 'global', description: 'Replay the onboarding tour' },
  { id: 'focus-mode', label: 'Focus Mode', keys: 'Cmd+Shift+F', category: 'global', description: 'Toggle focus mode (hide sidebar and chrome)' },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', keys: 'Cmd+Shift+L', category: 'global', description: 'Show or hide the sidebar' },
  { id: 'escape', label: 'Close / Dismiss', keys: 'Esc', category: 'global', description: 'Close any open modal or command palette', suppressInInput: false },

  // ── Navigation (no-modifier single keys) ──
  { id: 'nav-dashboard', label: 'Go to Dashboard', keys: 'D', category: 'global', description: 'Navigate to Dashboard', suppressInInput: true },
  { id: 'nav-subjects', label: 'Go to Focus Areas', keys: 'S', category: 'global', description: 'Navigate to Focus Areas', suppressInInput: true },
  { id: 'nav-projects', label: 'Go to Projects', keys: 'P', category: 'global', description: 'Navigate to Projects', suppressInInput: true },
  { id: 'nav-habits', label: 'Go to Habits', keys: 'H', category: 'global', description: 'Navigate to Habits', suppressInInput: true },
  { id: 'nav-reports', label: 'Go to Reports', keys: 'R', category: 'global', description: 'Navigate to Reports', suppressInInput: true },
  { id: 'nav-calendar', label: 'Go to Tasks', keys: 'C', category: 'global', description: 'Navigate to Tasks/Calendar', suppressInInput: true },

  // ── Dashboard ──
  { id: 'dash-log-time', label: 'Log Study Time', keys: 'N', category: 'dashboard', description: 'Open log study time modal', suppressInInput: true, routes: ['/'] },
  { id: 'dash-widget-1', label: 'Toggle Widget 1', keys: '1', category: 'dashboard', description: 'Toggle first widget visibility', suppressInInput: true, routes: ['/'] },
  { id: 'dash-widget-2', label: 'Toggle Widget 2', keys: '2', category: 'dashboard', description: 'Toggle second widget visibility', suppressInInput: true, routes: ['/'] },
  { id: 'dash-widget-3', label: 'Toggle Widget 3', keys: '3', category: 'dashboard', description: 'Toggle third widget visibility', suppressInInput: true, routes: ['/'] },
  { id: 'dash-widget-4', label: 'Toggle Widget 4', keys: '4', category: 'dashboard', description: 'Toggle fourth widget visibility', suppressInInput: true, routes: ['/'] },
  { id: 'dash-widget-5', label: 'Toggle Widget 5', keys: '5', category: 'dashboard', description: 'Toggle fifth widget visibility', suppressInInput: true, routes: ['/'] },
  { id: 'dash-widget-6', label: 'Toggle Widget 6', keys: '6', category: 'dashboard', description: 'Toggle sixth widget visibility', suppressInInput: true, routes: ['/'] },
  { id: 'dash-widget-7', label: 'Toggle Widget 7', keys: '7', category: 'dashboard', description: 'Toggle seventh widget visibility', suppressInInput: true, routes: ['/'] },
  { id: 'dash-widget-8', label: 'Toggle Widget 8', keys: '8', category: 'dashboard', description: 'Toggle eighth widget visibility', suppressInInput: true, routes: ['/'] },
  { id: 'dash-cal-prev', label: 'Previous Month', keys: '←', category: 'dashboard', description: 'Navigate calendar to previous month', suppressInInput: true, routes: ['/'] },
  { id: 'dash-cal-next', label: 'Next Month', keys: '→', category: 'dashboard', description: 'Navigate calendar to next month', suppressInInput: true, routes: ['/'] },
  { id: 'dash-cal-today', label: 'Jump to Today', keys: 'T', category: 'dashboard', description: 'Jump calendar to today', suppressInInput: true, routes: ['/'] },

  // ── Subjects ──
  { id: 'subj-add', label: 'Add Focus Area', keys: 'N', category: 'subjects', description: 'Add a new focus area', suppressInInput: true, routes: ['/subjects'] },
  { id: 'subj-edit', label: 'Edit Focus Area', keys: 'E', category: 'subjects', description: 'Edit selected focus area', suppressInInput: true, routes: ['/subjects'] },
  { id: 'subj-delete', label: 'Delete Focus Area', keys: 'Del', category: 'subjects', description: 'Delete selected focus area', suppressInInput: true, routes: ['/subjects'] },
  { id: 'subj-up', label: 'Previous Focus Area', keys: '↑', category: 'subjects', description: 'Navigate to previous focus area', suppressInInput: true, routes: ['/subjects'] },
  { id: 'subj-down', label: 'Next Focus Area', keys: '↓', category: 'subjects', description: 'Navigate to next focus area', suppressInInput: true, routes: ['/subjects'] },
  { id: 'subj-open', label: 'Open Focus Area', keys: 'Enter', category: 'subjects', description: 'Open/edit selected focus area', suppressInInput: true, routes: ['/subjects'] },

  // ── Habits ──
  { id: 'habit-add', label: 'Add Habit', keys: 'N', category: 'habits', description: 'Add a new habit', suppressInInput: true, routes: ['/habits'] },
  { id: 'habit-toggle', label: 'Toggle Today', keys: 'Space', category: 'habits', description: 'Toggle today\'s check-in', suppressInInput: true, routes: ['/habits'] },
  { id: 'habit-archive', label: 'Archive Habit', keys: 'A', category: 'habits', description: 'Archive selected habit', suppressInInput: true, routes: ['/habits'] },
  { id: 'habit-up', label: 'Previous Habit', keys: '↑', category: 'habits', description: 'Navigate to previous habit', suppressInInput: true, routes: ['/habits'] },
  { id: 'habit-down', label: 'Next Habit', keys: '↓', category: 'habits', description: 'Navigate to next habit', suppressInInput: true, routes: ['/habits'] },
  { id: 'habit-1', label: 'Select Habit 1', keys: '1', category: 'habits', description: 'Select first habit', suppressInInput: true, routes: ['/habits'] },
  { id: 'habit-2', label: 'Select Habit 2', keys: '2', category: 'habits', description: 'Select second habit', suppressInInput: true, routes: ['/habits'] },
  { id: 'habit-3', label: 'Select Habit 3', keys: '3', category: 'habits', description: 'Select third habit', suppressInInput: true, routes: ['/habits'] },
  { id: 'habit-4', label: 'Select Habit 4', keys: '4', category: 'habits', description: 'Select fourth habit', suppressInInput: true, routes: ['/habits'] },
  { id: 'habit-5', label: 'Select Habit 5', keys: '5', category: 'habits', description: 'Select fifth habit', suppressInInput: true, routes: ['/habits'] },
  { id: 'habit-6', label: 'Select Habit 6', keys: '6', category: 'habits', description: 'Select sixth habit', suppressInInput: true, routes: ['/habits'] },
  { id: 'habit-7', label: 'Select Habit 7', keys: '7', category: 'habits', description: 'Select seventh habit', suppressInInput: true, routes: ['/habits'] },

  // ── Marks ──
  { id: 'mark-add', label: 'Add Mark', keys: 'N', category: 'marks', description: 'Add a new mark', suppressInInput: true, routes: ['/marks'] },
  { id: 'mark-delete', label: 'Delete Mark', keys: 'Del', category: 'marks', description: 'Delete selected mark', suppressInInput: true, routes: ['/marks'] },
  { id: 'mark-up', label: 'Previous Mark', keys: '↑', category: 'marks', description: 'Navigate to previous mark', suppressInInput: true, routes: ['/marks'] },
  { id: 'mark-down', label: 'Next Mark', keys: '↓', category: 'marks', description: 'Navigate to next mark', suppressInInput: true, routes: ['/marks'] },
  { id: 'mark-edit', label: 'Edit Mark', keys: 'Enter', category: 'marks', description: 'Edit selected mark', suppressInInput: true, routes: ['/marks'] },

  // ── Calendar ──
  { id: 'cal-add', label: 'Add Task', keys: 'N', category: 'calendar', description: 'Add a new task', suppressInInput: true, routes: ['/calendar'] },
  { id: 'cal-prev', label: 'Previous Month', keys: '←', category: 'calendar', description: 'Navigate to previous month', suppressInInput: true, routes: ['/calendar'] },
  { id: 'cal-next', label: 'Next Month', keys: '→', category: 'calendar', description: 'Navigate to next month', suppressInInput: true, routes: ['/calendar'] },
  { id: 'cal-today', label: 'Jump to Today', keys: 'T', category: 'calendar', description: 'Jump to today', suppressInInput: true, routes: ['/calendar'] },
  { id: 'cal-up', label: 'Previous Task', keys: '↑', category: 'calendar', description: 'Navigate to previous task', suppressInInput: true, routes: ['/calendar'] },
  { id: 'cal-down', label: 'Next Task', keys: '↓', category: 'calendar', description: 'Navigate to next task', suppressInInput: true, routes: ['/calendar'] },

  // ── Reports ──
  { id: 'report-day', label: 'Day View', keys: '1', category: 'reports', description: 'Switch to day period', suppressInInput: true, routes: ['/reports'] },
  { id: 'report-week', label: 'Week View', keys: '2', category: 'reports', description: 'Switch to week period', suppressInInput: true, routes: ['/reports'] },
  { id: 'report-month', label: 'Month View', keys: '3', category: 'reports', description: 'Switch to month period', suppressInInput: true, routes: ['/reports'] },
  { id: 'report-year', label: 'Year View', keys: '4', category: 'reports', description: 'Switch to year period', suppressInInput: true, routes: ['/reports'] },
  { id: 'report-all', label: 'All Scope', keys: 'A', category: 'reports', description: 'Show all subjects', suppressInInput: true, routes: ['/reports'] },
  { id: 'report-academic', label: 'Academic Scope', keys: 'C', category: 'reports', description: 'Show academic only', suppressInInput: true, routes: ['/reports'] },
  { id: 'report-nonacademic', label: 'Non-Academic Scope', keys: 'N', category: 'reports', description: 'Show non-academic only', suppressInInput: true, routes: ['/reports'] },
]

/**
 * Check if the currently focused element is an input-like element
 * where keyboard shortcuts should be suppressed.
 */
export function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if ((el as HTMLElement).isContentEditable) return true
  const role = (el as HTMLElement).getAttribute('role')
  if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return true
  return false
}

/**
 * Normalize a keyboard event into a canonical shortcut key string.
 * e.g. Cmd+K, Ctrl+Shift+T, ?, Esc, Enter, Space, ←, ↑, Del
 */
export function eventToShortcutKey(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('Cmd')
  // Don't add Shift for keys that already encode it (e.g. ? = Shift+/)
  if (e.shiftKey && e.key !== 'Shift' && e.key !== '?') parts.push('Shift')
  if (e.altKey && e.key !== 'Alt') parts.push('Alt')

  // Normalize key names
  const key = e.key
  if (key === 'ArrowLeft') parts.push('←')
  else if (key === 'ArrowRight') parts.push('→')
  else if (key === 'ArrowUp') parts.push('↑')
  else if (key === 'ArrowDown') parts.push('↓')
  else if (key === 'Delete' || key === 'Backspace') parts.push('Del')
  else if (key === 'Escape') parts.push('Esc')
  else if (key === ' ') parts.push('Space')
  else if (key === 'Enter') parts.push('Enter')
  else if (key === '/') {
    // No modifier + / = ? on US/UK keyboards (Shift+/ is just / in this context)
    if (parts.length === 0) parts.push('?')
    else parts.push('/')
  }
  else if (key === '?') parts.push('?')
  else if (key.length === 1) parts.push(key.toUpperCase())
  else parts.push(key)

  return parts.join('+')
}

/**
 * Get shortcuts active for the current route.
 */
export function getShortcutsForRoute(pathname: string): Shortcut[] {
  return SHORTCUTS.filter((s) => {
    if (!s.routes || s.routes.length === 0) return true
    return s.routes.some((r) => pathname === r || (r !== '/' && pathname.startsWith(r)))
  })
}
