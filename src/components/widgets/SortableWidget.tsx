import React, { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '../../lib/utils'

interface SortableWidgetProps {
  id: string
  label: string
  onRemove?: () => void
  children: ReactNode
  className?: string
}

export function SortableWidget({
  id,
  label,
  onRemove,
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
      <div className="p-3">{children}</div>
    </div>
  )
}
