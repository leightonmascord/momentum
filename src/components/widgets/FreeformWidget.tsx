import { ReactNode, useRef, useState } from 'react'
import { cn } from '../../lib/utils'
import { MIN_WIDGET_PX_W, MIN_WIDGET_PX_H, MAX_WIDGET_PX_W, MAX_WIDGET_PX_H } from '../../lib/use-dashboard-widgets'

interface FreeformWidgetProps {
  id: string
  label: string
  width: number
  height: number
  initialX: number
  initialY: number
  onResize?: (size: { width: number; height: number }) => void
  onCommit?: (pos: { x: number; y: number }) => void
  onRemove?: () => void
  children: ReactNode
  className?: string
}

/**
 * Freeform-mode widget — no dnd-kit dependency.
 *
 * Dragging: header pointer events update a live CSS transform for immediate
 * visual feedback. On pointer-up the final x/y is committed to the parent
 * via `onCommit`.
 *
 * Resizing: corner handle pointer events update width/height via `onResize`.
 */
export function FreeformWidget({
  id,
  label,
  width,
  height,
  initialX,
  initialY,
  onResize,
  onCommit,
  onRemove,
  children,
  className,
}: FreeformWidgetProps) {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: initialX, baseY: initialY }
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return
      setDragOffset({
        x: ev.clientX - dragRef.current.startX,
        y: ev.clientY - dragRef.current.startY,
      })
    }
    const onUp = (ev: PointerEvent) => {
      const r = dragRef.current
      if (r) {
        const newX = Math.max(0, r.baseX + (ev.clientX - r.startX))
        const newY = Math.max(0, r.baseY + (ev.clientY - r.startY))
        onCommit?.({ x: newX, y: newY })
      }
      dragRef.current = null
      setDragOffset({ x: 0, y: 0 })
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
      onResize({ width: newW, height: newH })
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className={cn(
        'group/widget relative h-full w-full overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-slate-800',
        'border-slate-200 dark:border-slate-700',
        className
      )}
      data-widget-id={id}
      style={{
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        transition: dragRef.current ? 'none' : 'transform 0.1s ease',
      }}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        className="flex cursor-grab items-center justify-between border-b border-slate-200 px-3 py-2 active:cursor-grabbing dark:border-slate-700"
      >
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
          </svg>
          <h3 className="select-none text-sm font-semibold text-slate-800 dark:text-slate-100">
            {label}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          {onRemove && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
              aria-label="Remove widget"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="h-[calc(100%-2.5rem)] overflow-hidden p-3">{children}</div>
      {onResize && (
        <div
          onPointerDown={onResizePointerDown}
          className="absolute bottom-1 right-1 z-10 h-5 w-5 cursor-nwse-resize rounded-sm bg-slate-300 opacity-0 transition-opacity group-hover/widget:opacity-100 dark:bg-slate-600"
          aria-label="Resize widget"
        />
      )}
    </div>
  )
}
