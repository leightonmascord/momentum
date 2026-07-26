import React, { ReactNode, useRef, useState } from 'react'
import { cn } from '../../lib/utils'

interface DashboardWidgetProps {
  id: string
  label: string
  onRemove?: () => void
  onReorder?: (fromId: string, toId: string) => void
  children: ReactNode
  className?: string
}

export function DashboardWidget({
  id,
  label,
  onRemove,
  onReorder,
  children,
  className,
}: DashboardWidgetProps) {
  const dragRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDragStart = (e: React.DragEvent<HTMLElement>) => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    setDragging(true)
  }

  const handleDragEnd = () => {
    setDragging(false)
  }

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    const fromId = e.dataTransfer.getData('text/plain')
    if (fromId && fromId !== id && onReorder) {
      onReorder(fromId, id)
    }
    setDragging(false)
  }

  return (
    <div
      ref={dragRef}
      data-widget-id={id}
      className={cn(
        'relative bg-white dark:bg-slate-800 rounded-lg shadow-sm border h-full',
        'transition-all duration-150',
        dragging
          ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 opacity-60 scale-95'
          : 'border-slate-200 dark:border-slate-700 opacity-100',
        className
      )}
    >
      <div
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-slate-700 cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 select-none">{label}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Drag to reorder</p>
          </div>
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
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
