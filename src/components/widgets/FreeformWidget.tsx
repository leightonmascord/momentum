import { useRef, useCallback, ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '../../lib/utils'
import { MIN_WIDGET_COLS, MAX_WIDGET_COLS, MIN_WIDGET_PX_H, MAX_WIDGET_PX_H } from '../../lib/use-dashboard-widgets'

interface FreeformWidgetProps {
  id: string
  label: string
  cols: number
  minHeight: number
  onResize: (next: { cols: number; minHeight: number }) => void
  onRemove?: () => void
  children: ReactNode
  className?: string
}

function colSpanPx(cols: number): number {
  if (cols >= 3) return 12
  if (cols === 2) return 6
  return 4
}

export function FreeformWidget({
  id,
  label,
  cols,
  minHeight,
  onResize,
  onRemove,
  children,
  className,
}: FreeformWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const resizeRef = useRef<{ startX: number; startY: number; origCols: number; origH: number; widthPerStep: number; heightPerStep: number } | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Use a fixed step so small drags produce visible changes regardless of
    // grid width. The grid is fluid; using gridWidth / 3 makes the handle
    // feel sluggish on wide viewports and frantic on narrow ones.
    const widthPerStep = 220
    const heightPerStep = 24
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origCols: cols, origH: minHeight, widthPerStep, heightPerStep }
    const onMove_ = (ev: PointerEvent) => {
      if (!resizeRef.current) return
      const dx = ev.clientX - resizeRef.current.startX
      const dy = ev.clientY - resizeRef.current.startY
      const deltaCols = Math.round(dx / resizeRef.current.widthPerStep)
      const deltaRows = Math.round(dy / resizeRef.current.heightPerStep)
      const nextCols = Math.max(MIN_WIDGET_COLS, Math.min(MAX_WIDGET_COLS, resizeRef.current.origCols + deltaCols))
      const nextHeight = Math.max(MIN_WIDGET_PX_H, Math.min(MAX_WIDGET_PX_H, resizeRef.current.origH + deltaRows * resizeRef.current.heightPerStep))
      onResize({ cols: nextCols, minHeight: nextHeight })
    }
    const onUp_ = () => {
      resizeRef.current = null
      window.removeEventListener('pointermove', onMove_)
      window.removeEventListener('pointerup', onUp_)
    }
    window.addEventListener('pointermove', onMove_)
    window.addEventListener('pointerup', onUp_)
  }, [cols, minHeight, onResize])

  const span = colSpanPx(cols)

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? 'none',
    zIndex: isDragging ? 50 : undefined,
    position: 'relative',
    willChange: isDragging ? 'transform' : undefined,
    minHeight,
    gridColumn: `span ${span} / span ${span}`,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-widget-id={id}
      className={cn(
        'flex flex-col bg-white dark:bg-slate-800 rounded-lg shadow-sm border',
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
        className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-slate-700 cursor-grab active:cursor-grabbing select-none shrink-0"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
          </div>
          <h3 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100 select-none">{label}</h3>
        </div>
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
      <div ref={surfaceRef} className="flex-1 p-3 overflow-auto">{children}</div>
      <div
        onPointerDown={onResizePointerDown}
        className="absolute bottom-1 right-1 flex h-6 w-6 cursor-nwse-resize items-end justify-end rounded border border-slate-200/80 bg-white/90 p-0.5 shadow-sm hover:border-primary-400 hover:bg-white dark:border-slate-600 dark:bg-slate-800/90 dark:hover:border-primary-400"
        aria-label="Resize widget"
        title="Drag to resize width and height"
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M11 4 4 11" />
          <path d="M11 8 8 11" />
        </svg>
      </div>
    </div>
  )
}
