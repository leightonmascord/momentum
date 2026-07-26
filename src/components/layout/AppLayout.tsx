import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { isInputFocused, eventToShortcutKey, SHORTCUTS, formatShortcutLabel } from '../../lib/shortcuts'
import { Kbd } from '../ui/Kbd'
import { UndoToast } from '../ui/UndoToast'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'

import { SyncBanner } from '../ui/SyncBanner'
import { FloatingTimerBanner } from '../ui/FloatingTimerBanner'
import { OnboardingTour } from '../ui/OnboardingTour'
import { DevBanner } from '../ui/DevBanner'
import { CommandPalette, useCommandPalette } from '../ui/CommandPalette'
import { useFocusMode } from '../../lib/use-focus-mode'
import { useData } from '../../app/providers'
import { format } from 'date-fns'

  const NAV_ITEMS = [
    { to: '/', label: 'Dashboard', icon: '🏠' },
    { to: '/subjects', label: 'Focus Areas', icon: '📚' },
    { to: '/projects', label: 'Projects', icon: '🎯' },
    { to: '/calendar', label: 'Tasks', icon: '📅' },
    { to: '/study', label: 'Study', icon: '🧠' },
    { to: '/reports', label: 'Reports', icon: '📈' },
    { to: '/habits', label: 'Habits', icon: '🔥' },
    { to: '/schedule', label: 'Schedule', icon: '📋' },
    { to: '/marks', label: 'Marks', icon: '📝' },
    { to: '/groups', label: 'Groups', icon: '👥' },
    { to: '/categories', label: 'Categories', icon: '🗂️' },
    { to: '/reviews', label: 'AI Review', icon: '🤖' },
    { to: '/settings', label: 'Settings', icon: '⚙️' },
  ]
  const PREFS_KEY = 'momentum-nav-prefs'
  const PREFS_VERSION_KEY = 'momentum-nav-prefs-version'
  const CURRENT_PREFS_VERSION = 4
interface NavPrefs {
  order: string[]
  hidden: string[]
}
const DEFAULT_PREFS: NavPrefs = { order: [], hidden: ['/marks', '/groups', '/categories', '/reviews'] }

function loadPrefs(): NavPrefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PREFS }
  try {
    const version = Number(localStorage.getItem(PREFS_VERSION_KEY))
    if (version < CURRENT_PREFS_VERSION) {
      localStorage.setItem(PREFS_VERSION_KEY, String(CURRENT_PREFS_VERSION))
      localStorage.setItem('momentum-nav-just-reset', 'true')
      savePrefs(DEFAULT_PREFS)
      return { ...DEFAULT_PREFS }
    }
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw) as Partial<NavPrefs>
    const order = Array.isArray(parsed.order)
      ? parsed.order.filter((t): t is string => typeof t === 'string')
      : []
    const hidden = Array.isArray(parsed.hidden)
      ? parsed.hidden.filter((t): t is string => typeof t === 'string')
      : []
    return { order, hidden }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function savePrefs(prefs: NavPrefs) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch { /* ignore */ }
}

/** Apply saved order/visibility to the base NAV_ITEMS, dropping unknowns and backfilling new ones. */
function applyPrefs(base: typeof NAV_ITEMS, prefs: NavPrefs): typeof NAV_ITEMS {
  const hidden = new Set(prefs.hidden)
  const baseByTo = new Map<string, (typeof base)[number]>()
  for (const item of base) baseByTo.set(item.to, item)
  const knownTos = new Set(base.map((item) => item.to))

  // Ordered list: saved order intersected with current nav, then anything from base not yet listed.
  const ordered: typeof NAV_ITEMS = []
  const seen = new Set<string>()
  for (const to of prefs.order) {
    if (!knownTos.has(to) || seen.has(to)) continue
    const item = baseByTo.get(to)
    if (item) {
      ordered.push(item)
      seen.add(to)
    }
  }
  for (const item of base) {
    if (!seen.has(item.to)) ordered.push(item)
  }

  return ordered.filter((item) => !hidden.has(item.to))
}


export function AppLayout({ children }: { children: ReactNode }) {
  const { toggle: toggleFocusMode } = useFocusMode()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    setIsMobile(mql.matches)
    function onChange(e: MediaQueryListEvent) { setIsMobile(e.matches) }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  // Close mobile sidebar on Escape so users can dismiss it without finding the close button
  useEffect(() => {
    if (!mobileSidebarOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileSidebarOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileSidebarOpen])
  const [prefs, setPrefs] = useState<NavPrefs>(() => loadPrefs())
  const [draftPrefs, setDraftPrefs] = useState<NavPrefs | null>(null)
  const [navNotification, setNavNotification] = useState(() => {
    if (typeof localStorage === 'undefined') return false
    try {
      if (localStorage.getItem('momentum-nav-just-reset') === 'true') {
        localStorage.removeItem('momentum-nav-just-reset')
        return true
      }
    } catch {}
    return false
  })
  const [showHelp, setShowHelp] = useState(false)
  const { open, setOpen, toggle } = useCommandPalette()
  useEffect(() => {
    function onCmdPalette() { toggle() }
    window.addEventListener('momentum:command-palette', onCmdPalette)
    return () => window.removeEventListener('momentum:command-palette', onCmdPalette)
  }, [toggle])
  const navigate = useNavigate()
  const { data } = useData()
  const dueCount = useMemo(() => {
    const today = new Date()
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = format(tomorrow, 'yyyy-MM-dd')
    return data.assignments.filter((a) => !a.deletedAt && !a.completed && a.dueDate !== '' && a.dueDate <= tomorrowStr).length
  }, [data.assignments])
  const location = useLocation()

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const NAV_ROUTE: Record<string, string> = {
      'nav-dashboard': '/',
      'nav-subjects': '/subjects',
      'nav-projects': '/projects',
      'nav-habits': '/habits',
      'nav-reports': '/reports',
      'nav-calendar': '/calendar',
      'nav-settings': '/settings',
    }

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const focused = isInputFocused()
      const targetIsInput = !!target && (
        target.tagName.toLowerCase() === 'input' ||
        target.tagName.toLowerCase() === 'textarea' ||
        target.tagName.toLowerCase() === 'select' ||
        target.isContentEditable ||
        target.getAttribute('role') === 'textbox' ||
        target.getAttribute('role') === 'combobox' ||
        target.getAttribute('role') === 'searchbox'
      )
      const shortcutKey = eventToShortcutKey(e)
      // Find matching shortcut by keys string
      const shortcut = SHORTCUTS.find((s) => s.keys === shortcutKey)
      if (!shortcut) return
      // Suppress all shortcuts except Esc and Cmd+K/Ctrl+K when typing in any input-like target.
      if (focused || targetIsInput) {
        const allowed = shortcutKey === 'Esc' || shortcutKey === 'Cmd+K' || shortcutKey === 'Ctrl+K'
        if (!allowed) return
      }

      // ? shortcut requires Shift on US/UK keyboards; the focused-input guard above already handled suppression

      e.preventDefault()
      e.stopPropagation()

      const route = NAV_ROUTE[shortcut.id]
      if (route) {
        navigate(route)
        return
      }

      switch (shortcut.id) {
        // ── App-wide actions ──
        case 'command-palette':
          window.dispatchEvent(new CustomEvent('momentum:command-palette'))
          break
        case 'log-time':
          window.dispatchEvent(new CustomEvent('momentum:log-time'))
          break
        case 'start-timer':
          window.dispatchEvent(new CustomEvent('momentum:timer-toggle'))
          break
        case 'stop-timer':
          window.dispatchEvent(new CustomEvent('momentum:timer-stop-save'))
          break
        case 'help':
        case 'help-alt':
          setShowHelp(true)
          break
        case 'focus-mode':
          toggleFocusMode()
          break
        case 'toggle-sidebar':
          setSidebarOpen((prev) => !prev)
          break
        case 'undo':
          window.dispatchEvent(new CustomEvent('momentum:undo'))
          break
        case 'redo':
          window.dispatchEvent(new CustomEvent('momentum:redo'))
          break
        case 'escape':
          window.dispatchEvent(new CustomEvent('momentum:escape'))
          break
        case 'discard-session':
          window.dispatchEvent(new CustomEvent('momentum:discard-session'))
          break
        case 'replay-tour':
          window.dispatchEvent(new CustomEvent('momentum:replay-tour'))
          break

        // ── Dashboard-specific ──
        case 'dash-log-time':
          window.dispatchEvent(new CustomEvent('momentum:log-time'))
          break
        case 'dash-customise':
          window.dispatchEvent(new CustomEvent('momentum:dashboard-customise'))
          break
        case 'dash-widget-1': case 'dash-widget-2': case 'dash-widget-3': case 'dash-widget-4':
        case 'dash-widget-5': case 'dash-widget-6': case 'dash-widget-7': case 'dash-widget-8': {
          const idx = parseInt(shortcut.id.replace('dash-widget-', ''), 10)
          window.dispatchEvent(new CustomEvent('momentum:dashboard-toggle-widget', { detail: idx }))
          break
        }
        case 'dash-cal-prev':
          window.dispatchEvent(new CustomEvent('momentum:dashboard-calendar-prev'))
          break
        case 'dash-cal-next':
          window.dispatchEvent(new CustomEvent('momentum:dashboard-calendar-next'))
          break
        case 'dash-cal-today':
          window.dispatchEvent(new CustomEvent('momentum:dashboard-calendar-today'))
          break

        // ── Subjects-specific ──
        case 'subj-add':
          window.dispatchEvent(new CustomEvent('momentum:subjects-add'))
          break
        case 'subj-edit':
          window.dispatchEvent(new CustomEvent('momentum:subjects-edit'))
          break
        case 'subj-delete':
          window.dispatchEvent(new CustomEvent('momentum:subjects-delete'))
          break
        case 'subj-up':
          window.dispatchEvent(new CustomEvent('momentum:subjects-prev'))
          break
        case 'subj-down':
          window.dispatchEvent(new CustomEvent('momentum:subjects-next'))
          break
        case 'subj-open':
          window.dispatchEvent(new CustomEvent('momentum:subjects-open'))
          break

        // ── Habits-specific ──
        case 'habit-add':
          window.dispatchEvent(new CustomEvent('momentum:habits-add'))
          break
        case 'habit-toggle':
          window.dispatchEvent(new CustomEvent('momentum:habits-toggle-today'))
          break
        case 'habit-archive':
          window.dispatchEvent(new CustomEvent('momentum:habits-archive'))
          break
        case 'habit-up':
          window.dispatchEvent(new CustomEvent('momentum:habits-prev'))
          break
        case 'habit-down':
          window.dispatchEvent(new CustomEvent('momentum:habits-next'))
          break
        case 'habit-1': case 'habit-2': case 'habit-3': case 'habit-4':
        case 'habit-5': case 'habit-6': case 'habit-7': {
          const idx = parseInt(shortcut.id.replace('habit-', ''), 10)
          window.dispatchEvent(new CustomEvent('momentum:habits-select', { detail: idx }))
          break
        }

        // ── Marks-specific ──
        case 'mark-add':
          window.dispatchEvent(new CustomEvent('momentum:marks-add'))
          break
        case 'mark-delete':
          window.dispatchEvent(new CustomEvent('momentum:marks-delete'))
          break
        case 'mark-up':
          window.dispatchEvent(new CustomEvent('momentum:marks-prev'))
          break
        case 'mark-down':
          window.dispatchEvent(new CustomEvent('momentum:marks-next'))
          break
        case 'mark-edit':
          window.dispatchEvent(new CustomEvent('momentum:marks-edit'))
          break

        // ── Calendar-specific ──
        case 'cal-add':
          window.dispatchEvent(new CustomEvent('momentum:calendar-add'))
          break
        case 'cal-prev':
          window.dispatchEvent(new CustomEvent('momentum:calendar-prev-month'))
          break
        case 'cal-next':
          window.dispatchEvent(new CustomEvent('momentum:calendar-next-month'))
          break
        case 'cal-today':
          window.dispatchEvent(new CustomEvent('momentum:calendar-today'))
          break
        case 'cal-up':
          window.dispatchEvent(new CustomEvent('momentum:calendar-prev-task'))
          break
        case 'cal-down':
          window.dispatchEvent(new CustomEvent('momentum:calendar-next-task'))
          break

        // ── Reports-specific ──
        case 'report-day':
          window.dispatchEvent(new CustomEvent('momentum:reports-period', { detail: 'week' }))
          break
        case 'report-week':
          window.dispatchEvent(new CustomEvent('momentum:reports-period', { detail: 'month' }))
          break
        case 'report-month':
          window.dispatchEvent(new CustomEvent('momentum:reports-period', { detail: 'threeMonths' }))
          break
        case 'report-year':
          window.dispatchEvent(new CustomEvent('momentum:reports-period', { detail: 'all' }))
          break
        case 'report-all':
          window.dispatchEvent(new CustomEvent('momentum:reports-scope', { detail: 'all' }))
          break
        case 'report-academic':
          window.dispatchEvent(new CustomEvent('momentum:reports-scope', { detail: 'academic' }))
          break
        case 'report-nonacademic':
          window.dispatchEvent(new CustomEvent('momentum:reports-scope', { detail: 'nonAcademic' }))
          break
      }
    }

    document.addEventListener('keyup', onKeyDown)
    return () => document.removeEventListener('keyup', onKeyDown)
  }, [navigate, setSidebarOpen, toggleFocusMode])

  // Listen for momentum:help events from other components
  useEffect(() => {
    function onHelp() { setShowHelp(true) }
    window.addEventListener('momentum:help', onHelp)
    return () => window.removeEventListener('momentum:help', onHelp)
  }, [])

  const visibleItems = applyPrefs(NAV_ITEMS, prefs)
  function openCustomizer() {
    const allTos = NAV_ITEMS.map((i) => i.to)
    const savedOrder = prefs.order.length > 0 ? prefs.order : allTos
    const order = [...savedOrder.filter((to) => allTos.includes(to))]
    for (const to of allTos) {
      if (!order.includes(to)) order.push(to)
    }
    setDraftPrefs({
      order,
      hidden: [...prefs.hidden],
    })
  }

  function closeCustomizer() {
    setDraftPrefs(null)
  }

  function applyCustomizer() {
    if (!draftPrefs) return
    setPrefs(draftPrefs)
    savePrefs(draftPrefs)
    setDraftPrefs(null)
  }

  const dragFromIdx = useRef<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  function reorderItem(fromIdx: number, toIdx: number) {
    if (!draftPrefs || fromIdx === toIdx) return
    setDraftPrefs((prev) => {
      if (!prev) return prev
      const order = [...prev.order]
      const [moved] = order.splice(fromIdx, 1)
      order.splice(toIdx, 0, moved)
      return { ...prev, order }
    })
  }

  function toggleHidden(to: string) {
    if (!draftPrefs) return
    setDraftPrefs((prev) => {
      if (!prev) return prev
      const hidden = prev.hidden.includes(to)
        ? prev.hidden.filter((t) => t !== to)
        : [...prev.hidden, to]
      return { ...prev, hidden }
    })
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <SyncBanner />
      <DevBanner />
      <div className="flex flex-1 overflow-hidden">
      <aside
        role="navigation"
        aria-label="Main navigation"
        className={cn(
          'sidebar-container hidden md:flex flex-col border-r border-slate-200 bg-white transition-all duration-200',
          'dark:border-slate-700 dark:bg-slate-800',
          sidebarOpen ? 'w-56' : 'w-0 overflow-hidden border-r-0'
        )}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <span className="text-lg font-semibold text-primary-600 dark:text-primary-400">
            Momentum
          </span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100'
                )
              }
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              {item.to === '/calendar' && dueCount > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">{dueCount}</span>
              )}
            </NavLink>
          ))}
        </nav>
        {navNotification && (
          <div className="mx-2 mb-1 rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-800 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-200">
            <div className="flex items-start justify-between gap-2">
              <p>Sidebar cleaned up. Use <strong>Customise</strong> below to add back any pages you want.</p>
              <button
                onClick={() => setNavNotification(false)}
                className="shrink-0 rounded p-0.5 text-primary-500 hover:text-primary-700 dark:text-primary-300"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}
        <div className="border-t border-slate-200 px-2 py-2 dark:border-slate-700">
          <button
            onClick={openCustomizer}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
            aria-label="Customise navigation"
          >
            <span aria-hidden>🛠️</span>
            <span>Customise</span>
          </button>
        </div>
      </aside>

      {/* Mobile sidebar slide-over */}
      {isMobile && (
        <>
          {/* Backdrop */}
          <div
            className={cn(
              'fixed inset-0 z-30 bg-black/50 transition-opacity',
              mobileSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />
          {/* Slide-over panel */}
          <aside
            role="navigation"
            aria-label="Main navigation"
            className={cn(
              'sidebar-container fixed left-0 top-0 z-40 flex h-full w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200',
              'dark:border-slate-700 dark:bg-slate-800',
              mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
            )}
          >
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <span className="text-lg font-semibold text-primary-600 dark:text-primary-400">
                Momentum
              </span>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
              {visibleItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileSidebarOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100'
                    )
                  }
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>
            <div className="border-t border-slate-200 px-2 py-2 dark:border-slate-700">
              <button
                onClick={() => { openCustomizer(); setMobileSidebarOpen(false) }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                aria-label="Customise navigation"
              >
                <span aria-hidden>🛠️</span>
                <span>Customise</span>
              </button>
            </div>
          </aside>
        </>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="app-header flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-800">
          <button
            onClick={() => isMobile ? setMobileSidebarOpen(!mobileSidebarOpen) : setSidebarOpen(!sidebarOpen)}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            aria-label="Toggle sidebar"
          >
            ☰
          </button>
          <h1 className="text-base font-medium text-slate-700 dark:text-slate-200">
            {NAV_ITEMS.find((n) => n.to === location.pathname)?.label ?? 'Momentum'}
          </h1>
        </header>
        <main className="app-main flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
      <UndoToast />
      <FloatingTimerBanner />
      <OnboardingTour />
      <Modal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        title="Keyboard Shortcuts"
        className="max-w-3xl"
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {['global', 'dashboard', 'subjects', 'habits', 'marks', 'calendar', 'reports', 'timer'].map((category) => {
            const items = SHORTCUTS.filter((s) => s.category === category)
            if (items.length === 0) return null
            return (
              <div key={category} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {category}
                </h3>
                <ul className="space-y-1.5">
                  {items.map((shortcut) => (
                    <li key={shortcut.id} className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-slate-700 dark:text-slate-300">{shortcut.label}</span>
                      <Kbd>{formatShortcutLabel(shortcut.keys)}</Kbd>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
        <div className="mt-4 flex justify-end border-t border-slate-200 pt-4 dark:border-slate-700">
          <Button variant="secondary" size="sm" onClick={() => { setShowHelp(false); window.dispatchEvent(new CustomEvent('momentum:replay-tour')) }}>
            Replay Tour
          </Button>
        </div>
      </Modal>
      <Modal
        open={draftPrefs !== null}
        onClose={closeCustomizer}
        title="Customise Navigation"
      >
        {draftPrefs && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Drag items to reorder them or hide them from the sidebar.
            </p>
            <ul className="space-y-1">
              {draftPrefs.order.map((to, idx) => {
                const item = NAV_ITEMS.find((n) => n.to === to)
                if (!item) return null
                const isHidden = draftPrefs.hidden.includes(to)
                return (
                  <li
                    key={to}
                    draggable={true}
                    onDragStart={() => { dragFromIdx.current = idx }}
                    onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx) }}
                    onDragEnter={(e) => { e.preventDefault(); setDragOverIdx(idx) }}
                    onDragLeave={() => setDragOverIdx(null)}
                    onDrop={() => {
                      const from = dragFromIdx.current
                      dragFromIdx.current = null
                      setDragOverIdx(null)
                      if (from !== null) reorderItem(from, idx)
                    }}
                    onDragEnd={() => { dragFromIdx.current = null; setDragOverIdx(null) }}
                    className={cn(
                      'flex cursor-grab items-center gap-2 rounded-md border px-2 py-1.5 active:cursor-grabbing',
                      'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
                      dragOverIdx === idx && 'border-primary-400 dark:border-primary-500'
                    )}
                  >
                    <span className="cursor-grab text-slate-400 dark:text-slate-500" aria-label="Drag to reorder">⠿</span>
                    <span className="text-lg" aria-hidden>{item.icon}</span>
                    <span
                      className={cn(
                        'flex-1 text-sm font-medium text-slate-700 dark:text-slate-200',
                        isHidden && 'text-slate-400 line-through dark:text-slate-500'
                      )}
                    >
                      {item.label}
                    </span>
                    <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        onChange={() => toggleHidden(to)}
                        className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-700"
                      />
                      Show
                    </label>
                  </li>
                )
              })}
            </ul>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              <Button variant="secondary" size="sm" onClick={closeCustomizer}>
                Cancel
              </Button>
              <Button size="sm" onClick={applyCustomizer}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </div>
  )
}