import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatShortcutLabel } from '../../lib/shortcuts'
import { Button } from './Button'
const TOUR_KEY = 'momentum-tour-completed'
const TOUR_STEP_KEY = 'momentum-tour-step'
interface Step {
  title: string
  description: string | (() => string)
  /** Optional element selector for cutout highlight */
  target?: string
  /** Route to navigate to before showing this step */
  route?: string
}
const STEPS: Step[] = [
  { title: 'Welcome to Momentum', description: 'Your personal study tracker. Let us show you around.' , route: '/'},
  { title: 'Your Dashboard', description: 'See your streak, daily goal, and recent sessions at a glance.' , target: 'div[data-tour=\"dashboard\"]', route: '/'},
  { title: 'Customise Your Dashboard', description: 'Click "Customise" to show/hide widgets, change widths, and reorder.', target: '[data-tour="customise-btn"]', route: '/' },
  { title: 'Study Timer', description: 'Use the Pomodoro timer or simple stopwatch to track study sessions.' , target: '[data-tour=\"timer\"]', route: '/'},
  { title: 'Log Study Time', description: 'Add a session log: subject, duration, date, optional note.' , route: '/'},
  { title: 'Keyboard Shortcuts', description: () => `Press ? for help, or ${formatShortcutLabel('Cmd+K')} to open the command palette.`, route: '/' },
]
export function OnboardingTour() {
  const [completed, setCompleted] = useState(() => {
    if (typeof localStorage === 'undefined') return true
    return localStorage.getItem(TOUR_KEY) === 'true'
  })
  const [activeStep, setActiveStep] = useState(() => {
    if (typeof localStorage === 'undefined') return 0
    try {
      const stored = Number(localStorage.getItem(TOUR_STEP_KEY))
      return Number.isFinite(stored) && stored >= 0 && stored < STEPS.length ? stored : 0
    } catch {
      return 0
    }
  })
  const [visible, setVisible] = useState(false)
  const navigate = useNavigate()
  const overlayRef = useRef<HTMLDivElement>(null)
  // Show tour after a short delay on first load (only if not completed)
  useEffect(() => {
    if (!completed) {
      const timer = setTimeout(() => setVisible(true), 500)
      return () => clearTimeout(timer)
    }
  }, [completed])
  // Persist activeStep while running so user can resume after pressing Escape
  useEffect(() => {
    if (visible && !completed) {
      try { localStorage.setItem(TOUR_STEP_KEY, String(activeStep)) } catch {}
    }
  }, [activeStep, visible, completed])
  // Navigate to step's route when step changes
  useEffect(() => {
    const step = STEPS[activeStep]
    if (step?.route && visible) {
      navigate(step.route)
    }
  }, [activeStep, visible, navigate])
  // Keyboard: Escape hides without completing; Enter advances
  useEffect(() => {
    if (!visible) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Close without permanently dismissing — step is persisted, will resume next time
        setVisible(false)
      } else if (e.key === 'Enter') {
        next()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, activeStep])
  function next() {
    if (activeStep >= STEPS.length - 1) {
      complete()
    } else {
      setActiveStep((s) => s + 1)
    }
  }
  /** Permanent dismiss — used by Skip, ×, and Finish */
  function skip() {
    complete()
  }
  function complete() {
    setVisible(false)
    setCompleted(true)
    try {
      localStorage.setItem(TOUR_KEY, 'true')
      localStorage.removeItem(TOUR_STEP_KEY)
    } catch {}
  }
  // Allow replay from settings (Cmd+Shift+I or Replay button)
  useEffect(() => {
    function onReplay() {
      try {
        localStorage.removeItem(TOUR_KEY)
        localStorage.removeItem(TOUR_STEP_KEY)
      } catch {}
      setCompleted(false)
      setActiveStep(0)
      setVisible(true)
    }
    window.addEventListener('momentum:replay-tour', onReplay)
    return () => window.removeEventListener('momentum:replay-tour', onReplay)
  }, [])
  if (!visible) return null
  const step = STEPS[activeStep]
  if (!step) return null
  // Try to find target element for cutout
  let targetRect: DOMRect | null = null
  if (step.target) {
    const el = document.querySelector(step.target)
    if (el) {
      targetRect = el.getBoundingClientRect()
    }
  }
  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Onboarding: ${step.title}`}
    >
      {/* Semi-transparent backdrop — visual only, no click handler */}
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
      {/* Cutout around target (if found) */}
      {targetRect && (
        <div
          className="absolute rounded-lg ring-2 ring-primary-500 ring-offset-2"
          style={{
            top: targetRect.top - 8,
            left: targetRect.left - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
          }}
          aria-hidden="true"
        />
      )}
      {/* Card */}
      <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800">
        {/* Close button — top-right */}
        <button
          type="button"
          onClick={skip}
          aria-label="Close onboarding"
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {/* Step counter */}
        <div className="mb-4 flex items-center gap-2">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i <= activeStep ? 'bg-primary-500' : 'bg-slate-200 dark:bg-slate-700'
              }`}
              aria-hidden="true"
            />
          ))}
        </div>
        <h2 className="mb-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
          {step.title}
        </h2>
        <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
          {typeof step.description === 'function' ? step.description() : step.description}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            Step {activeStep + 1} of {STEPS.length}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={skip}>
              Skip
            </Button>
            <Button size="sm" onClick={next}>
              {activeStep >= STEPS.length - 1 ? 'Finish' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}