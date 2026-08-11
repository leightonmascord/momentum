// Tests for useTimerTabLock — cross-tab timer ownership lock.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTimerTabLock } from '../use-timer-tab-lock'

class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length() { return this.store.size }
  clear() { this.store.clear() }
  getItem(key: string) { return this.store.get(key) ?? null }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null }
  removeItem(key: string) { this.store.delete(key) }
  setItem(key: string, value: string) { this.store.set(key, value) }
}

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage()
  // BroadcastChannel is unavailable in happy-dom test env by default. The
  // hook falls back to localStorage-only ownership in that case — it always
  // reports the running tab as the owner.
})

describe('useTimerTabLock (no BroadcastChannel)', () => {
  it('returns isOwner=true when timer is running and no peer exists', () => {
    const { result } = renderHook(() => useTimerTabLock(true))
    expect(result.current.isOwner).toBe(true)
    expect(result.current.isOwnedElsewhere).toBe(false)
  })

  it('returns isOwner=false when timer is not running', () => {
    const { result } = renderHook(() => useTimerTabLock(false))
    expect(result.current.isOwner).toBe(false)
    expect(result.current.isOwnedElsewhere).toBe(false)
  })
})
