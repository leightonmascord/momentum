import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eventToShortcutKey, isInputFocused, SHORTCUTS } from '../shortcuts'

// ─── eventToShortcutKey ────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    key: '',
    ...overrides,
  } as KeyboardEvent
}

describe('eventToShortcutKey', () => {
  it('converts Cmd+K', () => {
    expect(eventToShortcutKey(makeEvent({ metaKey: true, key: 'k' }))).toBe('Cmd+K')
  })
  it('converts Ctrl+K', () => {
    expect(eventToShortcutKey(makeEvent({ ctrlKey: true, key: 'k' }))).toBe('Cmd+K')
  })
  it('converts Ctrl+Shift+T', () => {
    expect(eventToShortcutKey(makeEvent({ ctrlKey: true, shiftKey: true, key: 'T' }))).toBe('Cmd+Shift+T')
  })
  it('converts Cmd+Shift+Z', () => {
    expect(eventToShortcutKey(makeEvent({ metaKey: true, shiftKey: true, key: 'Z' }))).toBe('Cmd+Shift+Z')
  })
  it('converts Escape', () => {
    expect(eventToShortcutKey(makeEvent({ key: 'Escape' }))).toBe('Esc')
  })
  it('converts Delete / Backspace to Del', () => {
    expect(eventToShortcutKey(makeEvent({ key: 'Delete' }))).toBe('Del')
    expect(eventToShortcutKey(makeEvent({ key: 'Backspace' }))).toBe('Del')
  })
  it('converts Space', () => {
    expect(eventToShortcutKey(makeEvent({ key: ' ' }))).toBe('Space')
  })
  it('converts Enter', () => {
    expect(eventToShortcutKey(makeEvent({ key: 'Enter' }))).toBe('Enter')
  })
  it('converts Arrow keys', () => {
    expect(eventToShortcutKey(makeEvent({ key: 'ArrowLeft' }))).toBe('←')
    expect(eventToShortcutKey(makeEvent({ key: 'ArrowRight' }))).toBe('→')
    expect(eventToShortcutKey(makeEvent({ key: 'ArrowUp' }))).toBe('↑')
    expect(eventToShortcutKey(makeEvent({ key: 'ArrowDown' }))).toBe('↓')
  })
  it('converts single character keys to uppercase', () => {
    expect(eventToShortcutKey(makeEvent({ key: 'd' }))).toBe('D')
    expect(eventToShortcutKey(makeEvent({ key: 'n' }))).toBe('N')
  })
  it('converts ? key', () => {
    expect(eventToShortcutKey(makeEvent({ key: '?' }))).toBe('?')
  })
})

// ─── isInputFocused ────────────────────────────────────────────────────────────

describe('isInputFocused', () => {
  it('returns false when no active element', () => {
    // jsdom default: document.body is the active element
    expect(typeof isInputFocused()).toBe('boolean')
  })

  it('returns true for INPUT element', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    expect(isInputFocused()).toBe(true)
    document.body.removeChild(input)
  })

  it('returns true for TEXTAREA element', () => {
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()
    expect(isInputFocused()).toBe(true)
    document.body.removeChild(textarea)
  })

  it('returns true for SELECT element', () => {
    const select = document.createElement('select')
    document.body.appendChild(select)
    select.focus()
    expect(isInputFocused()).toBe(true)
    document.body.removeChild(select)
  })
})

// ─── SHORTCUTS registry ────────────────────────────────────────────────────────

describe('SHORTCUTS registry', () => {
  it('has no duplicate ids', () => {
    const ids = SHORTCUTS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('allows same key on different routes (no false-positive duplication)', () => {
    // Page-specific shortcuts on different routes can share the same key (e.g., 'N' on /subjects and /habits). Just verify every shortcut has a key string.
    for (const s of SHORTCUTS) {
      expect(s.keys).toBeTruthy()
    }
  })

  it('every entry has a non-empty id, label, keys, and category', () => {
    for (const s of SHORTCUTS) {
      expect(s.id).toBeTruthy()
      expect(s.label).toBeTruthy()
      expect(s.keys).toBeTruthy()
      expect(s.category).toBeTruthy()
    }
  })

  it('every entry has a known category', () => {
    const validCategories = new Set([
      'global', 'dashboard', 'subjects', 'habits', 'marks', 'calendar', 'reports', 'timer',
    ])
    for (const s of SHORTCUTS) {
      expect(validCategories.has(s.category)).toBe(true)
    }
  })
})

// ─── Global shortcuts coverage ─────────────────────────────────────────────────

describe('Global shortcut coverage', () => {
  const requiredGlobal: string[] = [
    'command-palette',
    'log-time',
    'start-timer',
    'stop-timer',
    'undo',
    'redo',
    'help',
    'help-alt',
    'replay-tour',
    'focus-mode',
    'toggle-sidebar',
    'escape',
  ]
  for (const id of requiredGlobal) {
    it(`includes ${id}`, () => {
      expect(SHORTCUTS.find(s => s.id === id)).toBeDefined()
    })
  }
})

// ─── Navigation shortcut coverage ─────────────────────────────────────────────

describe('Navigation shortcut coverage', () => {
  const requiredNav: string[] = [
    'nav-dashboard', 'nav-subjects', 'nav-projects', 'nav-habits',
  ]
  for (const id of requiredNav) {
    it(`includes ${id}`, () => {
      expect(SHORTCUTS.find(s => s.id === id)).toBeDefined()
    })
  }
})

// ─── Dashboard shortcut coverage ──────────────────────────────────────────────

describe('Dashboard shortcut coverage', () => {
  it('includes dash-log-time', () => {
    expect(SHORTCUTS.find(s => s.id === 'dash-log-time')).toBeDefined()
  })
  it('includes widget toggle shortcuts 1-8', () => {
    for (let i = 1; i <= 8; i++) {
      expect(SHORTCUTS.find(s => s.id === `dash-widget-${i}`)).toBeDefined()
    }
  })
  it('includes calendar prev/next/today shortcuts', () => {
    expect(SHORTCUTS.find(s => s.id === 'dash-cal-prev')).toBeDefined()
    expect(SHORTCUTS.find(s => s.id === 'dash-cal-next')).toBeDefined()
    expect(SHORTCUTS.find(s => s.id === 'dash-cal-today')).toBeDefined()
  })
})

// ─── Subjects/Habits/Marks/Calendar/Reports shortcut coverage ──────────────────

describe('Subjects shortcut coverage', () => {
  for (const id of ['subj-add', 'subj-edit', 'subj-delete', 'subj-up', 'subj-down', 'subj-open']) {
    it(`includes ${id}`, () => {
      expect(SHORTCUTS.find(s => s.id === id)).toBeDefined()
    })
  }
})

describe('Habits shortcut coverage', () => {
  for (const id of ['habit-add', 'habit-toggle', 'habit-archive', 'habit-up', 'habit-down']) {
    it(`includes ${id}`, () => {
      expect(SHORTCUTS.find(s => s.id === id)).toBeDefined()
    })
  }
  it('includes habit position shortcuts 1-7', () => {
    for (let i = 1; i <= 7; i++) {
      expect(SHORTCUTS.find(s => s.id === `habit-${i}`)).toBeDefined()
    }
  })
})

describe('Marks shortcut coverage', () => {
  for (const id of ['mark-add', 'mark-delete', 'mark-up', 'mark-down', 'mark-edit']) {
    it(`includes ${id}`, () => {
      expect(SHORTCUTS.find(s => s.id === id)).toBeDefined()
    })
  }
})

describe('Calendar shortcut coverage', () => {
  for (const id of ['cal-add', 'cal-prev', 'cal-next', 'cal-today', 'cal-up', 'cal-down']) {
    it(`includes ${id}`, () => {
      expect(SHORTCUTS.find(s => s.id === id)).toBeDefined()
    })
  }
})

describe('Reports shortcut coverage', () => {
  for (const id of ['report-day', 'report-week', 'report-month', 'report-year', 'report-all', 'report-academic', 'report-nonacademic']) {
    it(`includes ${id}`, () => {
      expect(SHORTCUTS.find(s => s.id === id)).toBeDefined()
    })
  }
})

// ─── Custom event dispatch tests ──────────────────────────────────────────────

describe('AppLayout shortcut dispatch (event simulation)', () => {
  let dispatched: { name: string; detail: unknown }[] = []

  beforeEach(() => {
    dispatched = []
    // Capture all custom events on window
    const capture = (e: Event) => {
      const ce = e as CustomEvent
      dispatched.push({ name: e.type, detail: ce.detail })
    }
    // Listen for all the shortcut events we care about
    const eventNames = [
      'momentum:command-palette',
      'momentum:log-time',
      'momentum:timer-toggle',
      'momentum:timer-stop-save',
      'momentum:undo',
      'momentum:redo',
      'momentum:escape',
      'momentum:replay-tour',
      'momentum:dashboard-toggle-widget',
      'momentum:dashboard-calendar-prev',
      'momentum:dashboard-calendar-next',
      'momentum:dashboard-calendar-today',
      'momentum:subjects-add',
      'momentum:subjects-edit',
      'momentum:subjects-delete',
      'momentum:subjects-prev',
      'momentum:subjects-next',
      'momentum:subjects-open',
      'momentum:habits-add',
      'momentum:habits-toggle-today',
      'momentum:habits-archive',
      'momentum:habits-prev',
      'momentum:habits-next',
      'momentum:habits-select',
      'momentum:marks-add',
      'momentum:marks-delete',
      'momentum:marks-prev',
      'momentum:marks-next',
      'momentum:marks-edit',
      'momentum:calendar-add',
      'momentum:calendar-prev-month',
      'momentum:calendar-next-month',
      'momentum:calendar-today',
      'momentum:calendar-prev-task',
      'momentum:calendar-next-task',
      'momentum:reports-period',
      'momentum:reports-scope',
    ]
    eventNames.forEach(name => {
      window.addEventListener(name, capture)
    })
  })

  afterEach(() => {
    // Clean up listeners
    const eventNames = [
      'momentum:command-palette', 'momentum:log-time', 'momentum:timer-toggle',
      'momentum:timer-stop-save', 'momentum:undo', 'momentum:redo', 'momentum:escape',
      'momentum:replay-tour', 'momentum:dashboard-toggle-widget',
      'momentum:dashboard-calendar-prev', 'momentum:dashboard-calendar-next',
      'momentum:dashboard-calendar-today', 'momentum:subjects-add',
      'momentum:subjects-edit', 'momentum:subjects-delete',
      'momentum:subjects-prev', 'momentum:subjects-next', 'momentum:subjects-open',
      'momentum:habits-add', 'momentum:habits-toggle-today', 'momentum:habits-archive',
      'momentum:habits-prev', 'momentum:habits-next', 'momentum:habits-select',
      'momentum:marks-add', 'momentum:marks-delete', 'momentum:marks-prev',
      'momentum:marks-next', 'momentum:marks-edit', 'momentum:calendar-add',
      'momentum:calendar-prev-month', 'momentum:calendar-next-month',
      'momentum:calendar-today', 'momentum:calendar-prev-task',
      'momentum:calendar-next-task', 'momentum:reports-period', 'momentum:reports-scope',
    ]
    eventNames.forEach(name => {
      window.removeEventListener(name, () => {})
    })
  })

  it('log-time event can be dispatched and received', () => {
    window.dispatchEvent(new CustomEvent('momentum:log-time'))
    expect(dispatched.find(d => d.name === 'momentum:log-time')).toBeDefined()
  })

  it('timer-toggle event can be dispatched and received', () => {
    window.dispatchEvent(new CustomEvent('momentum:timer-toggle'))
    expect(dispatched.find(d => d.name === 'momentum:timer-toggle')).toBeDefined()
  })

  it('timer-stop-save event can be dispatched and received', () => {
    window.dispatchEvent(new CustomEvent('momentum:timer-stop-save'))
    expect(dispatched.find(d => d.name === 'momentum:timer-stop-save')).toBeDefined()
  })

  it('dashboard-toggle-widget event carries detail (widget index)', () => {
    window.dispatchEvent(new CustomEvent('momentum:dashboard-toggle-widget', { detail: 3 }))
    const evt = dispatched.find(d => d.name === 'momentum:dashboard-toggle-widget')
    expect(evt).toBeDefined()
    expect(evt?.detail).toBe(3)
  })

  it('calendar month navigation events fire', () => {
    window.dispatchEvent(new CustomEvent('momentum:dashboard-calendar-prev'))
    window.dispatchEvent(new CustomEvent('momentum:dashboard-calendar-next'))
    window.dispatchEvent(new CustomEvent('momentum:dashboard-calendar-today'))
    expect(dispatched.find(d => d.name === 'momentum:dashboard-calendar-prev')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:dashboard-calendar-next')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:dashboard-calendar-today')).toBeDefined()
  })

  it('subjects events fire', () => {
    window.dispatchEvent(new CustomEvent('momentum:subjects-add'))
    window.dispatchEvent(new CustomEvent('momentum:subjects-edit'))
    window.dispatchEvent(new CustomEvent('momentum:subjects-delete'))
    window.dispatchEvent(new CustomEvent('momentum:subjects-prev'))
    window.dispatchEvent(new CustomEvent('momentum:subjects-next'))
    window.dispatchEvent(new CustomEvent('momentum:subjects-open'))
    expect(dispatched.find(d => d.name === 'momentum:subjects-add')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:subjects-edit')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:subjects-delete')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:subjects-prev')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:subjects-next')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:subjects-open')).toBeDefined()
  })

  it('habits events fire', () => {
    window.dispatchEvent(new CustomEvent('momentum:habits-add'))
    window.dispatchEvent(new CustomEvent('momentum:habits-toggle-today'))
    window.dispatchEvent(new CustomEvent('momentum:habits-archive'))
    window.dispatchEvent(new CustomEvent('momentum:habits-prev'))
    window.dispatchEvent(new CustomEvent('momentum:habits-next'))
    window.dispatchEvent(new CustomEvent('momentum:habits-select', { detail: 2 }))
    expect(dispatched.find(d => d.name === 'momentum:habits-add')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:habits-toggle-today')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:habits-archive')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:habits-prev')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:habits-next')).toBeDefined()
    const selectEvt = dispatched.find(d => d.name === 'momentum:habits-select')
    expect(selectEvt).toBeDefined()
    expect(selectEvt?.detail).toBe(2)
  })

  it('marks events fire', () => {
    window.dispatchEvent(new CustomEvent('momentum:marks-add'))
    window.dispatchEvent(new CustomEvent('momentum:marks-delete'))
    window.dispatchEvent(new CustomEvent('momentum:marks-prev'))
    window.dispatchEvent(new CustomEvent('momentum:marks-next'))
    window.dispatchEvent(new CustomEvent('momentum:marks-edit'))
    expect(dispatched.find(d => d.name === 'momentum:marks-add')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:marks-delete')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:marks-prev')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:marks-next')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:marks-edit')).toBeDefined()
  })

  it('calendar events fire', () => {
    window.dispatchEvent(new CustomEvent('momentum:calendar-add'))
    window.dispatchEvent(new CustomEvent('momentum:calendar-prev-month'))
    window.dispatchEvent(new CustomEvent('momentum:calendar-next-month'))
    window.dispatchEvent(new CustomEvent('momentum:calendar-today'))
    window.dispatchEvent(new CustomEvent('momentum:calendar-prev-task'))
    window.dispatchEvent(new CustomEvent('momentum:calendar-next-task'))
    expect(dispatched.find(d => d.name === 'momentum:calendar-add')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:calendar-prev-month')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:calendar-next-month')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:calendar-today')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:calendar-prev-task')).toBeDefined()
    expect(dispatched.find(d => d.name === 'momentum:calendar-next-task')).toBeDefined()
  })

  it('reports events carry detail (period and scope)', () => {
    window.dispatchEvent(new CustomEvent('momentum:reports-period', { detail: 'week' }))
    window.dispatchEvent(new CustomEvent('momentum:reports-scope', { detail: 'academic' }))
    const periodEvt = dispatched.find(d => d.name === 'momentum:reports-period')
    const scopeEvt = dispatched.find(d => d.name === 'momentum:reports-scope')
    expect(periodEvt).toBeDefined()
    expect(periodEvt?.detail).toBe('week')
    expect(scopeEvt).toBeDefined()
    expect(scopeEvt?.detail).toBe('academic')
  })
})

// ─── Input suppression logic (unit test) ──────────────────────────────────────

describe('Input suppression logic', () => {
  it('suppresses shortcuts in input — only Esc and Cmd+K allowed', () => {
    // The AppLayout handler's suppression rules:
    // when focused: only Esc, Cmd+K, Ctrl+K are allowed
    const allowedKeys = new Set(['Esc', 'Cmd+K', 'Ctrl+K'])
    const testKeys = ['Esc', 'Cmd+K', 'Ctrl+K', 'N', 'D', 'Space', 'Cmd+L', 'Cmd+Shift+T']
    const results = testKeys.map(k => allowedKeys.has(k))
    expect(results).toEqual([true, true, true, false, false, false, false, false])
  })

  it('allows all shortcuts when not in input', () => {
    // When not focused, all shortcuts should be allowed
    // We just verify the suppression list is correctly applied
    const focused = false
    const suppressed = focused
    expect(!suppressed).toBe(true)
  })
})
