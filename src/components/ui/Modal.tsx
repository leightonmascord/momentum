import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { cn } from '../../lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)
  const mouseDownTargetRef = useRef<EventTarget | null>(null)
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return

    if (open && !el.open) {
      // Remember which element had focus before opening, so we can restore it on close
      lastFocusedRef.current = document.activeElement as HTMLElement | null
      el.showModal()
      // Focus the first focusable element inside the modal for a11y/keyboard
      requestAnimationFrame(() => {
        const focusable = el.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        focusable?.focus()
      })
    }
    if (!open && el.open) {
      el.close()
      // Restore focus to the trigger element
      lastFocusedRef.current?.focus()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
      onClose={onClose}
      // The native dialog fires `cancel` (ESC) and `click` on the backdrop pseudo-element.
      // We handle cancel explicitly here, so suppress the default native close to avoid the
      // double-fire of the onClose handler.
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onMouseDown={(e) => { mouseDownTargetRef.current = e.target }}
      onClick={(e) => {
        if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) {
          onClose()
        }
      }}
      className={cn(
        'w-full max-w-lg rounded-lg border border-slate-200 bg-white p-0 shadow-lg backdrop:bg-black/40',
        'dark:border-slate-700 dark:bg-slate-800',
        className
      )}
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return
        const el = dialogRef.current
        if (!el) return
        const focusable = el.querySelectorAll<HTMLElement>(
          'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus() }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus() }
        }
      }}
    >
      {title && (
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 id="modal-title" className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
          >
            ✕
          </button>
        </div>
      )}
      <div className="p-4">{children}</div>
    </dialog>
  )
}