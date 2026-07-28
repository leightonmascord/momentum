import { ReactNode, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '../../lib/utils'
import { MIN_WIDGET_PX_W, MIN_WIDGET_PX_H, MAX_WIDGET_PX_W, MAX_WIDGET_PX_H } from '../../lib/use-dashboard-widgets'

type Mode = 'grid' | 'freeform'

interface DashboardWidgetProps {
  id: string
  label: string
  mode: Mode
  /** Grid-mode width in columns (1-3). */
  cols: number
  /** Freeform-mode pixel size. */
  width?: number
  height?: number
  onResizeGrid?: (cols: number) => void
  onResizeFreeform?: (size: { width: number; height: number }) => void
  onRemove?: () => void
  children: ReactNode
  className?: string
}

/**
 * Unified dashboard widget wrapper.
 *
 * - Grid mode: container with column-span, side resize button cycles cols.
 * - Freeform mode: absolute positioning, drag corner handle resizes pixels.
 *
 * Drag-and-drop is delegated to the parent (DndContext + SortableContext)
 * via `useSortable`. The wrapper applies the transform but suppresses the
 * default ghost so the parent can use a DragOverlay for a clean preview.
 *
 * Uses a named Tailwind group (`group/widget`) so it does not collide with
 * any inner `group` utility (e.g. heatmap tooltips inside the study-streak
 * widget), which would cause all child tooltips to show on widget hover.
 */
export function DashboardWidget({
  id,
  label,
  mode,
  cols,
  width,
  height,
  onResizeGrid,
  onResizeFreeform,
  onRemove,
  children,
  className,
}: DashboardWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const resizeRef = useRef<{
    startX: number
    startY: number
    startW: number
    startH: number
  } | null>(null)

  const onFreeformResizePointerDown = (e: React.PointerEvent) => {
    if (!onResizeFreeform || width === undefined || height === undefined) return
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
      onResizeFreeform({ width: newW, height: newH })
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
    transition,
    opacity: isDragging ? 0.3 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={mode === 'freeform' ? { ...style, width, height } : style}
      className={cn(
        'group/widget relative h-full w-full overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-slate-800',
        'border-slate-200 dark:border-slate-700',
        className
      )}
      data-widget-id={id}
    >
      <div
        {...attributes}
        {...listeners}
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
          {mode === 'grid' && onResizeGrid && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onResizeGrid(cols >= 3 ? 1 : cols + 1)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="rounded p-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
              title={`Width: ${cols} of 3`}
            >
              {cols}w
            </button>
          )}
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
      {mode === 'freeform' && onResizeFreeform && (
        <div
          onPointerDown={onFreeformResizePointerDown}
          className="absolute bottom-1 right-1 z-10 h-5 w-5 cursor-nwse-resize rounded-sm bg-slate-300 opacity-0 transition-opacity group-hover/widget:opacity-100 dark:bg-slate-600"
          aria-label="Resize widget"
        />
      )}
    </div>
  )
}
