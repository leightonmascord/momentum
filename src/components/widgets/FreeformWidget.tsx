import { useRef, useCallback, ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { MIN_WIDGET_PX_W, MIN_WIDGET_PX_H, MAX_WIDGET_PX_W, MAX_WIDGET_PX_H } from '../../lib/use-dashboard-widgets'

interface FreeformWidgetProps {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
  onMove: (x: number, y: number) => void
  onResize: (width: number, height: number) => void
  onRemove?: () => void
  children: ReactNode
  className?: string
}

export function FreeformWidget({
  id,
  label,
  x,
  y,
  width,
  height,
  onMove,
  onResize,
  onRemove,
  children,
  className,
}: FreeformWidgetProps) {
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)
  const movedRef = useRef(false)

  // --- Drag to move ---
  const onDragPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return // ignore clicks on buttons
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: x, origY: y }
    movedRef.current = false
    const onMove_ = (ev: PointerEvent) => {
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.startX
      const dy = ev.clientY - dragRef.current.startY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedRef.current = true
      const nx = Math.max(0, dragRef.current.origX + dx)
      const ny = Math.max(0, dragRef.current.origY + dy)
      onMove(nx, ny)
    }
    const onUp_ = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove_)
      window.removeEventListener('pointerup', onUp_)
    }
    window.addEventListener('pointermove', onMove_)
    window.addEventListener('pointerup', onUp_)
  }, [x, y, onMove])

  // --- Resize ---
  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: width, origH: height }
    const onMove_ = (ev: PointerEvent) => {
      if (!resizeRef.current) return
      const dx = ev.clientX - resizeRef.current.startX
      const dy = ev.clientY - resizeRef.current.startY
      const nw = Math.max(MIN_WIDGET_PX_W, Math.min(MAX_WIDGET_PX_W, resizeRef.current.origW + dx))
      const nh = Math.max(MIN_WIDGET_PX_H, Math.min(MAX_WIDGET_PX_H, resizeRef.current.origH + dy))
      onResize(nw, nh)
    }
    const onUp_ = () => {
      resizeRef.current = null
      window.removeEventListener('pointermove', onMove_)
      window.removeEventListener('pointerup', onUp_)
    }
    window.addEventListener('pointermove', onMove_)
    window.addEventListener('pointerup', onUp_)
  }, [width, height, onResize])

  return (
    <div
      data-widget-id={id}
      className={cn(
        'absolute bg-white dark:bg-slate-800 rounded-lg shadow-sm border flex flex-col',
        'transition-[box-shadow,border-color] duration-150',
        'border-slate-200 dark:border-slate-700',
        className
      )}
      style={{ left: x, top: y, width, height, zIndex: 1 }}
    >
      {/* Drag handle */}
      <div
        onPointerDown={onDragPointerDown}
        className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-slate-700 cursor-grab active:cursor-grabbing select-none shrink-0"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300 shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 select-none">{label}</h3>
        </div>
        {onRemove && (
          <button
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
      {/* Body */}
      <div className="p-3 flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
      {/* Resize handle — large, visible corner with three diagonal grip lines */}
      <div
        onPointerDown={onResizePointerDown}
        className="absolute bottom-1 right-1 flex h-6 w-6 cursor-se-resize items-end justify-end rounded border border-slate-200/80 bg-white/90 p-0.5 shadow-sm hover:border-primary-400 hover:bg-white dark:border-slate-600 dark:bg-slate-800/90 dark:hover:border-primary-400"
        aria-label="Resize widget"
        title="Drag to resize"
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M11 4 4 11" />
          <path d="M11 8 8 11" />
        </svg>
      </div>
    </div>
  )
}
