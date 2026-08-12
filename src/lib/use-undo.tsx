// Global undo/redo stack with Ctrl+Z / Ctrl+Shift+Z support.
// Operations register themselves with an undo action; when undone, the action
// is pushed to the redo stack. Redo replays the original mutation.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

interface UndoAction {
  description: string
  undo: () => Promise<void>
  redo: () => Promise<void>
  timestamp: number
}

interface UndoContextValue {
  push: (action: Omit<UndoAction, 'timestamp'>) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  canUndo: boolean
  canRedo: boolean
  lastDescription: string | null
  dismiss: () => void
}

const UndoContext = createContext<UndoContextValue | null>(null)

const MAX_DEPTH = 50

export function UndoProvider({ children }: { children: ReactNode }) {
  const undoStack = useRef<UndoAction[]>([])
  const redoStack = useRef<UndoAction[]>([])
  const [, setVersion] = useState(0)
  const [toast, setToast] = useState<UndoAction | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toastTimer = useRef<any>(null)

  const isPushing = useRef(false)

  const push = useCallback((action: Omit<UndoAction, 'timestamp'>) => {
    // Guard against concurrent pushes — while undo/redo is executing,
    // a new push would corrupt the stack ordering. Instead of silently
    // dropping the action, surface a brief toast so the user knows their
    // action wasn't recorded (M12 fix).
    if (isPushing.current) {
      setToast({
        description: 'Action in progress — try again',
        undo: async () => {},
        redo: async () => {},
        timestamp: Date.now(),
      })
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(() => setToast(null), 2000)
      return
    }
    isPushing.current = true
    try {
      // Pushing a new action clears the redo stack (new branch)
      redoStack.current = []
      const full: UndoAction = { ...action, timestamp: Date.now() }
      undoStack.current.push(full)
      if (undoStack.current.length > MAX_DEPTH) {
        undoStack.current.shift()
      }
      setToast(full)
      setVersion((v) => v + 1)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(() => setToast(null), 6000)
    } finally {
      isPushing.current = false
    }
  }, [])

  const dismiss = useCallback(() => {
    setToast(null)
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current)
      toastTimer.current = null
    }
  }, [])

  const undo = useCallback(async () => {
    const action = undoStack.current.pop()
    if (!action) return
    try {
      await action.undo()
      redoStack.current.push(action)
    } catch (e) {
      console.error('Undo failed:', e)
    }
    dismiss()
    setVersion((v) => v + 1)
  }, [dismiss])

  const redo = useCallback(async () => {
    const action = redoStack.current.pop()
    if (!action) return
    try {
      await action.redo()
      undoStack.current.push(action)
    } catch (e) {
      console.error('Redo failed:', e)
    }
    dismiss()
    setVersion((v) => v + 1)
  }, [dismiss])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCtrlZ = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z'
      const isCtrlShiftZ = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z'
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (isCtrlZ) {
        e.preventDefault()
        void undo()
      } else if (isCtrlShiftZ) {
        e.preventDefault()
        void redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  const value = useMemo<UndoContextValue>(
    () => ({
      push,
      undo,
      redo,
      dismiss,
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
      lastDescription: toast?.description ?? null,
    }),
    [push, undo, redo, dismiss, toast, setVersion]
  )

  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>
}

export function useUndo() {
  const ctx = useContext(UndoContext)
  if (!ctx) throw new Error('useUndo must be used within UndoProvider')
  return ctx
}