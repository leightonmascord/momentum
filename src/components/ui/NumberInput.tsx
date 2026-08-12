import { useState } from 'react'

interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  className?: string
}

export function NumberInput({ value, onChange, min = 0, className = 'input w-24 text-right' }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? String(value)

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={display}
      onChange={(e) => {
        const next = e.target.value
        if (next === '') {
          setDraft('')
          return
        }
        if (!/^\d+$/.test(next)) {
          return
        }
        setDraft(next)
        const parsed = Number(next)
        if (!Number.isNaN(parsed)) {
          onChange(Math.max(min, parsed))
        }
      }}
      onBlur={() => {
        if (draft === null) {
          return
        }
        if (draft === '') {
          // Leave the field empty rather than snapping to `min` — the caller
          // validates on submit. This avoids the surprise of clearing a field
          // and having it jump to `min` (L7 fix).
          setDraft(null)
          return
        }
        const parsed = Number(draft)
        onChange(Number.isNaN(parsed) ? min : Math.max(min, parsed))
        setDraft(null)
      }}
      className={className}
    />
  )
}
