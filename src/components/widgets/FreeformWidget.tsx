import { useRef, useCallback, ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '../../lib/utils'
import { MIN_WIDGET_PX_H, MAX_WIDGET_PX_H } from '../../lib/use-dashboard-widgets'

interface FreeformWidgetProps {
  id: string
  label: string
  cols: number
  minHeight: number
  onResize: (minHeight: number) => void
  onRemove?: () => void
  onColsChange?: (cols: number) => void
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
  onColsChange,
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

  const resizeRef = useRef<{ startY: number; origH: number } | null>(null)

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { startY: e.clientY, origH: minHeight }
    const onMove_ = (ev: PointerEvent) => {
      if (!resizeRef.current) return
      const dy = ev.clientY - resizeRef.current.startY
      const nh = Math.max(MIN_WIDGET_PX_H, Math.min(MAX_WIDGET_PX_H, resizeRef.current.origH + dy))
      onResize(nh)
    }
    const onUp_ = () => {
      resizeRef.current = null
      window.removeEventListener('pointermove', onMove_)
      window.removeEventListener('pointerup', onUp_)
    }
    window.addEventListener('pointermove', onMove_)
    window.addEventListener('pointerup', onUp_)
  }, [minHeight, onResize])

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
        <div className="flex shrink-0 items-center gap-1">
          {onColsChange && (
            <select
              value={cols}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => onColsChange(Number(e.target.value))}
              aria-label="Widget width"
              title="Widget width"
              className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-xs text-slate-700 dark:text-slate-200"
            >
              <option value={1}>Narrow</option>
              <option value={2}>Medium</option>
              <option value={3}>Wide</option>
            </select>
          )}
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
      <div className="flex-1 p-3 overflow-auto">{children}</div>
      {/* Bottom resize handle */}
      <div
        onPointerDown={onResizePointerDown}
        className="flex h-3 cursor-ns-resize items-center justify-center border-t border-slate-100 dark:border-slate-700/60 text-slate-300 hover:text-primary-500 dark:text-slate-600 dark:hover:text-primary-400"
        aria-label="Resize widget height"
        title="Drag to resize height"
      >
        <svg viewBox="0 0 24 12" className="h-2 w-8" fill="currentColor">
          <circle cx="4" cy="6" r="1.2" />
          <circle cx="12" cy="6" r="1.2" />
          <circle cx="20" cy="6" r="1.2" />
        </svg>
      </div>
    </div>
  )
}
