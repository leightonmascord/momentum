import { cn } from '../../lib/utils'

export type FocusTag = 'focused' | 'distracted' | 'group' | 'revision'

const TAGS: FocusTag[] = ['focused', 'distracted', 'group', 'revision']

export function FocusTagSelector({ value, onChange }: { value: FocusTag | null; onChange: (tag: FocusTag | null) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {TAGS.map((tag) => (
        <button
          key={tag}
          onClick={() => onChange(value === tag ? null : tag)}
          className={cn(
            'text-xs px-2 py-0.5 rounded capitalize transition-colors border',
            value === tag
              ? 'bg-primary-100 border-primary-200 text-primary-800 dark:bg-primary-900/50 dark:border-primary-800 dark:text-primary-200'
              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700'
          )}
        >
          {tag}
        </button>
      ))}
    </div>
  )
}
