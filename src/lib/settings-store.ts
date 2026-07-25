/**
 * Shared settings storage — extracted from SettingsPage so non-page modules
 * (PomodoroTimer, Dashboard, auth-provider, etc.) can import without coupling
 * to the SettingsPage component tree.
 */

export type Settings = {
  darkMode: boolean
  pomodoroEnabled: boolean
  autoLogEnabled: boolean
  pomodoroFocusMinutes: number
  pomodoroBreakMinutes: number
  pomodoroLongBreakMinutes: number
  pomodoroCyclesBeforeLongBreak: number
  dailyTargetMinutes: number
  soundEnabled: boolean
  maxActiveHabits: number
  defaultArchiveDays: number
  settingsUpdatedAt: string
  devMode?: boolean
}

const STORAGE_KEY = 'momentum-settings'

export const DEFAULT_SETTINGS: Settings = {
  darkMode: true,
  pomodoroEnabled: true,
  autoLogEnabled: true,
  pomodoroFocusMinutes: 25,
  pomodoroBreakMinutes: 5,
  pomodoroLongBreakMinutes: 15,
  pomodoroCyclesBeforeLongBreak: 4,
  dailyTargetMinutes: 120,
  soundEnabled: true,
  maxActiveHabits: 3,
  defaultArchiveDays: 66,
  settingsUpdatedAt: '',
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch { /* ignore */ }
  const osPrefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  return { ...DEFAULT_SETTINGS, darkMode: osPrefersDark }
}

export function saveSettings(settings: Settings) {
  const toSave: Settings = { ...settings, settingsUpdatedAt: new Date().toISOString() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
}

export function applyDarkMode(enabled: boolean) {
  if (enabled) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}
