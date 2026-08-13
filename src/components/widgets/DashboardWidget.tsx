import { ReactNode, useEffect, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '../../lib/utils'
import { activeWidgetSize$, emitDragMeasure } from '../../lib/dashboard-drag-store'

interface DashboardWidgetProps {
  id: string
  label: string
  /** Grid-mode width in columns (1-3). */
  cols: number
  onResizeGrid?: (cols: number) => void
  onRemove?: () => void
  children: ReactNode
  className?: string
}

/**
 * Grid-mode dashboard widget wrapper.
 *
 * Container with column-span, side resize button cycles cols. Uses
 * @dnd-kit's `useSortable` for in-grid reordering via the parent DndContext.
 *
 * Uses a named Tailwind group (`group/widget`) so it does not collide with
 * any inner `group` utility (e.g. heatmap day tooltips inside study-streak),
 * which would otherwise activate every tooltip on widget hover.
 */
export function DashboardWidget({
  id,
  label,
  cols,
  onResizeGrid,
  onRemove,
  children,
  className,
}: DashboardWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  // Measure the widget's height when it's being dragged, so the dashboard
  // placeholder in the target column can match it and the reflow is clearly
  // visible as the user moves the widget across columns.
  const nodeRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (isDragging && nodeRef.current) {
      const h = nodeRef.current.getBoundingClientRect().height
      activeWidgetSize$.current = { height: h }
      emitDragMeasure()
    }
  }, [isDragging])

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  }

  return (
    <div
      ref={(el) => { setNodeRef(el); nodeRef.current = el }}
      style={style}
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
        className="flex cursor-grab items-center justify-between border-b border-slate-100 px-2 py-1 active:cursor-grabbing dark:border-slate-700"
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
          {onResizeGrid && (
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
    </div>
  )
}
