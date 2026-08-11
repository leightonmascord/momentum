import { ReactNode, useRef } from 'react'
import { cn } from '../../lib/utils'
import { MIN_WIDGET_PX_W, MIN_WIDGET_PX_H, MAX_WIDGET_PX_W, MAX_WIDGET_PX_H } from '../../lib/use-dashboard-widgets'

interface FreeformWidgetProps {
  id: string
  label: string
  width: number
  height: number
  /** Called during resize (each pointer-move). The caller should apply the
   *  size visually — either via React state or DOM manipulation. */
  onResize?: (size: { width: number; height: number }) => void
  /** Called once on pointer-up after a resize completes (cascade trigger). */
  onResizeEnd?: () => void
  /** Called on pointer-up after a drag completes. `pos` is the widget's new
   *  top-left corner relative to the container (NOT the pointer position). */
  onCommit?: (pos: { x: number; y: number }) => void
  onDragStart?: () => void
  onDragPreview?: (pos: { x: number; y: number }) => void
  onRemove?: () => void
  children: ReactNode
  className?: string
}

/**
 * Freeform-mode widget — no dnd-kit dependency.
 *
 * Both drag and resize apply CSS transforms / inline styles directly to the
 * root DOM node via a ref so the widget follows the pointer 1:1 with ZERO
 * React re-renders during the gesture.  On pointer-up the transform is
 * cleared and the final container-relative position/size is committed via
 * `onCommit` / `onResize` / `onResizeEnd`.
 *
 * Drag preserves the grab-point offset so the widget doesn't jump when
 * the user clicks off-center.
 */
export function FreeformWidget({
  id,
  label,
  width,
  height,
  onResize,
  onResizeEnd,
  onCommit,
  onDragStart,
  onDragPreview,
  onRemove,
  children,
  className,
}: FreeformWidgetProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  // ── Drag ──
  // Track the pointer's container-relative position at grab so we can
  // compute `newTopLeft = originalTopLeft + (currentPointer - grabPointer)`
  // and preserve the user's grab offset instead of snapping top-left.
  const dragRef = useRef<{
    grabPointerX: number
    grabPointerY: number
    widgetBaseX: number
    widgetBaseY: number
    container: HTMLElement
  } | null>(null)

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button, input, select, textarea, a, [data-resize-handle]')) return
    e.preventDefault()
    e.stopPropagation()
    target.setPointerCapture?.(e.pointerId)

    const widgetEl = (target.closest('[data-widget-id]') as HTMLElement | null) ?? target
    const container = (widgetEl.offsetParent as HTMLElement | null) ?? widgetEl
    const cRect = container.getBoundingClientRect()
    const widgetRect = widgetEl.getBoundingClientRect()

    // Widget's current top-left relative to the container.
    const widgetBaseX = widgetRect.left - cRect.left + container.scrollLeft
    const widgetBaseY = widgetRect.top - cRect.top + container.scrollTop

    // Pointer's position relative to the container.
    const grabPointerX = e.clientX - cRect.left + container.scrollLeft
    const grabPointerY = e.clientY - cRect.top + container.scrollTop

    dragRef.current = { grabPointerX, grabPointerY, widgetBaseX, widgetBaseY, container }
    onDragStart?.()

    const onMove = (ev: PointerEvent) => {
      const r = dragRef.current
      if (!r) return
      const cr = r.container.getBoundingClientRect()
      const currentPointerX = ev.clientX - cr.left + r.container.scrollLeft
      const currentPointerY = ev.clientY - cr.top + r.container.scrollTop
      const dx = currentPointerX - r.grabPointerX
      const dy = currentPointerY - r.grabPointerY
      // Apply transform directly to DOM — zero re-renders.
      if (rootRef.current) {
        rootRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
        rootRef.current.style.transition = 'none'
        rootRef.current.style.zIndex = '50'
      }
      onDragPreview?.({ x: Math.max(0, r.widgetBaseX + dx), y: Math.max(0, r.widgetBaseY + dy) })
    }

    const onUp = (ev: PointerEvent) => {
      const r = dragRef.current
      if (r) {
        const cr = r.container.getBoundingClientRect()
        const currentPointerX = ev.clientX - cr.left + r.container.scrollLeft
        const currentPointerY = ev.clientY - cr.top + r.container.scrollTop
        const dx = currentPointerX - r.grabPointerX
        const dy = currentPointerY - r.grabPointerY
        // Clear the direct-manipulation transform.
        if (rootRef.current) {
          rootRef.current.style.transform = ''
          rootRef.current.style.transition = ''
          rootRef.current.style.zIndex = ''
        }
        // Commit the widget's top-left (original + delta), not the pointer pos.
        onCommit?.({ x: Math.max(0, r.widgetBaseX + dx), y: Math.max(0, r.widgetBaseY + dy) })
      }
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── Resize handle ──
  const resizeRef = useRef<{
    startX: number
    startY: number
    startW: number
    startH: number
  } | null>(null)

  const onResizePointerDown = (e: React.PointerEvent) => {
    if (!onResize) return
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: width, startH: height }

    const onMove = (ev: PointerEvent) => {
      const r = resizeRef.current
      if (!r) return
      const dx = ev.clientX - r.startX
      const dy = ev.clientY - r.startY
      const newW = Math.max(MIN_WIDGET_PX_W, Math.min(MAX_WIDGET_PX_W, r.startW + dx))
      const newH = Math.max(MIN_WIDGET_PX_H, Math.min(MAX_WIDGET_PX_H, r.startH + dy))
      // Apply size directly to DOM — zero re-renders during resize.
      if (rootRef.current) {
        rootRef.current.style.width = `${newW}px`
        rootRef.current.style.height = `${newH}px`
        rootRef.current.style.transition = 'none'
        rootRef.current.style.zIndex = '50'
      }
    }

    const onUp = () => {
      if (rootRef.current) {
        const newW = parseFloat(rootRef.current.style.width) || width
        const newH = parseFloat(rootRef.current.style.height) || height
        // Clear inline override so React's CSS classes take back over.
        rootRef.current.style.width = ''
        rootRef.current.style.height = ''
        rootRef.current.style.transition = ''
        rootRef.current.style.zIndex = ''
        // Commit the final size via React state (single re-render).
        onResize?.({ width: newW, height: newH })
      }
      resizeRef.current = null
      onResizeEnd?.()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        'group/widget relative h-full w-full overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-slate-800',
        'border-slate-200 dark:border-slate-700',
        className
      )}
      data-widget-id={id}
      onPointerDown={onHeaderPointerDown}
    >
      <div className="flex cursor-grab items-center justify-between border-b border-slate-100 px-2 py-1 active:cursor-grabbing dark:border-slate-700">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
          </svg>
          <h3 className="select-none text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</h3>
        </div>
        <div className="flex items-center gap-1">
          {onRemove && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onRemove() }} onPointerDown={(e) => e.stopPropagation()}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200" aria-label="Remove widget">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="h-[calc(100%-2.5rem)] overflow-hidden p-3">{children}</div>
      {onResize && (
        <div onPointerDown={onResizePointerDown} data-resize-handle
          className="absolute bottom-1 right-1 z-10 h-5 w-5 cursor-nwse-resize rounded-sm bg-slate-300 opacity-0 transition-opacity group-hover/widget:opacity-100 dark:bg-slate-600"
          aria-label="Resize widget" />
      )}
    </div>
  )
}
