import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Kbd } from './Kbd'

/**
 * Wraps a clickable element and reveals a keyboard shortcut hint
 * (using the `Kbd` component) in the top-right corner on hover/focus.
 *
 * Usage:
 *   <ShortcutHint shortcutId="command-palette">
 *     <button>Open Palette</button>
 *   </ShortcutHint>
 *
 * Looks up the shortcut string from the central SHORTCUTS registry.
 * Falls back to the `shortcut` prop if you want to pass a literal string.
 */
import { SHORTCUTS } from '../../lib/shortcuts'

interface ShortcutHintProps {
  children: ReactNode
  shortcutId?: string
  shortcut?: string
  className?: string
}

export function ShortcutHint({ children, shortcutId, shortcut, className }: ShortcutHintProps) {
  const resolved =
    shortcut ??
    (shortcutId ? SHORTCUTS.find((s) => s.id === shortcutId)?.keys : undefined)
  if (!resolved) return <>{children}</>
  return (
    <span className={cn('group/shortcut relative inline-flex', className)}>
      {children}
      <span className="pointer-events-none absolute -top-2 -right-1 translate-y-0 opacity-0 transition-opacity duration-100 group-hover/shortcut:opacity-100 group-focus-within/shortcut:opacity-100">
        <Kbd>{resolved}</Kbd>
      </span>
    </span>
  )
}
