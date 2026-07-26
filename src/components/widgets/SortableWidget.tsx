import React, { useRef, ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '../../lib/utils'
import { MIN_WIDGET_COLS, MAX_WIDGET_COLS } from '../../lib/use-dashboard-widgets'

interface SortableWidgetProps {
  id: string
  label: string
  cols?: number
  onRemove?: () => void
  onResize?: (newCols: number) => void
  children: ReactNode
  className?: string
}

export function SortableWidget({
  id,
  label,
  cols,
  onRemove,
  onResize,
  children,
  className,
}: SortableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const resizeRef = useRef<{ startX: number; origCols: number; widthPerCol: number } | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const onResizePointerDown = (e: React.PointerEvent) => {
    if (!onResize || cols === undefined) return
    e.preventDefault()
    e.stopPropagation()
    // Fixed step (220px per col) so the handle feels consistent regardless of
    // viewport. The grid is fluid; using surfaceWidth / 3 made the widget
    // appear to widen during drag and snap back on release.
    const widthPerCol = 220
    resizeRef.current = { startX: e.clientX, origCols: cols, widthPerCol }
    const onMove = (ev: PointerEvent) => {
      if (!resizeRef.current) return
      const dx = ev.clientX - resizeRef.current.startX
      const deltaCols = Math.round(dx / resizeRef.current.widthPerCol)
      const next = Math.max(MIN_WIDGET_COLS, Math.min(MAX_WIDGET_COLS, resizeRef.current.origCols + deltaCols))
      if (next !== cols) onResize(next)
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? 'none',
    zIndex: isDragging ? 50 : undefined,
    position: 'relative' as const,
    willChange: isDragging ? 'transform' : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-widget-id={id}
      className={cn(
        'relative bg-white dark:bg-slate-800 rounded-lg shadow-sm border h-full',
        'transition-[box-shadow,border-color] duration-150',
        isDragging
          ? 'border-primary-400 dark:border-primary-500 shadow-lg shadow-primary-500/20 ring-2 ring-primary-400/40 opacity-95'
          : 'border-slate-200 dark:border-slate-700',
        className
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-slate-700 cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
          </div>
          <h3 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100 select-none">{label}</h3>
        </div>
        <div className="flex items-center gap-1">
          {onRemove && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onRemove() }}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
              aria-label="Remove widget"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div ref={surfaceRef} className="p-3">{children}</div>
      {onResize && (
        <div
          onPointerDown={onResizePointerDown}
          className="absolute right-0 top-1/2 -translate-y-1/2 flex h-12 w-3 cursor-ew-resize items-center justify-center rounded-l border border-r-0 border-slate-200 bg-white/80 text-slate-400 shadow-sm hover:border-primary-400 hover:bg-primary-50 hover:text-primary-600 dark:border-slate-600 dark:bg-slate-800/80 dark:hover:border-primary-400 dark:hover:bg-slate-700"
          aria-label="Resize widget width"
          title={`Drag to resize (${cols ?? 1}/${MAX_WIDGET_COLS} columns)`}
        >
          <svg viewBox="0 0 8 12" className="h-3 w-1.5" fill="currentColor">
            <circle cx="2" cy="3" r="1" />
            <circle cx="6" cy="3" r="1" />
            <circle cx="2" cy="9" r="1" />
            <circle cx="6" cy="9" r="1" />
          </svg>
        </div>
      )}
    </div>
  )
}
