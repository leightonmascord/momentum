import { describe, it, expect } from 'vitest'
import { format, subDays, differenceInCalendarDays } from 'date-fns'

function computeStreak(studyDates: string[], today = '2026-07-21'): number {
  const daySet = new Set(studyDates)
  let count = 0
  let missed = 0
  let d = new Date(today)
  while (true) {
    const ds = format(d, 'yyyy-MM-dd')
    if (daySet.has(ds)) {
      count++
      d = subDays(d, 1)
    } else {
      missed++
      if (missed > 1) break
      d = subDays(d, 1)
    }
  }
  return count
}

function computeLongestStreak(studyDates: string[]): number {
  const sortedDays = [...new Set(studyDates)].sort()
  if (sortedDays.length <= 1) return 0
  let max = 0
  let cur = 1
  for (let i = 1; i < sortedDays.length; i++) {
    const diff = differenceInCalendarDays(new Date(sortedDays[i]), new Date(sortedDays[i - 1]))
    if (diff <= 2) {
      cur++;
    } else {
      if (cur > max) max = cur;
      cur = 1;
    }
  }
  if (cur > max) max = cur
  return max
}

describe('computeStreak', () => {
  it('returns 0 for no study days', () => {
    expect(computeStreak([])).toBe(0)
  })

  it('returns 1 for one consecutive day (today)', () => {
    expect(computeStreak(['2026-07-21'])).toBe(1)
  })

  it('returns 7 for 7 consecutive days', () => {
    const days = [
      '2026-07-21',
      '2026-07-20',
      '2026-07-19',
      '2026-07-18',
      '2026-07-17',
      '2026-07-16',
      '2026-07-15',
    ]
    expect(computeStreak(days)).toBe(7)
  })

  it('allows one missed day in the chain', () => {
    // study on 21st, skip 20th, study 19th = streak 2
    const days = ['2026-07-21', '2026-07-19']
    expect(computeStreak(days)).toBe(2)
  })

  it('breaks after two missed days', () => {
    // 21st hit, 20th missed, 19th missed => streak stops at 1
    const days = ['2026-07-21', '2026-07-18']
    expect(computeStreak(days)).toBe(1)
  })

  it('alternating days produces streak of 2', () => {
    // 21st hit, 20th missed, 19th hit, 18th missed, 17th hit
    // hit 21st (count=1), miss 20th (missed=1), hit 19th (count=2), miss 18th (missed=2 break)
    const days = ['2026-07-21', '2026-07-19', '2026-07-17']
    expect(computeStreak(days)).toBe(2)
  })

  it('counts today even when there is an earlier gap', () => {
    const days = ['2026-07-21']
    expect(computeStreak(days)).toBe(1)
  })

  it('does not extend past a missing day before a gap', () => {
    // hits only on 21 and 19; 20 missed; streak = 2
    expect(computeStreak(['2026-07-21', '2026-07-19'])).toBe(2)
  })
})

describe('computeLongestStreak', () => {
  it('returns 0 for 0 or 1 days', () => {
    expect(computeLongestStreak([])).toBe(0)
    expect(computeLongestStreak(['2026-07-21'])).toBe(0)
  })

  it('returns 2 for 2 consecutive days', () => {
    expect(computeLongestStreak(['2026-07-21', '2026-07-20'])).toBe(2)
  })

  it('finds longest chain with one gap', () => {
    // 15-17-19-20-21 => gaps of 2,2,1,1. Each gap is <= 2 (at most one
    // missed day), so the whole run is one chain of 5.
    const days = ['2026-07-21', '2026-07-20', '2026-07-19', '2026-07-17', '2026-07-15']
    expect(computeLongestStreak(days)).toBe(5)
  })

  it('L3: refreshes the one-gap budget on every logged day (hit/miss/hit/miss/hit)', () => {
    // Mon, Wed, Fri — two single-day gaps. The one-gap budget must be
    // replenished after each logged day, so the longest streak is 3, not 2.
    const days = ['2026-07-13', '2026-07-15', '2026-07-17']
    expect(computeLongestStreak(days)).toBe(3)
  })

  it('handles gap > 2 correctly', () => {
    const days = ['2026-07-21', '2026-07-20', '2026-07-10']
    expect(computeLongestStreak(days)).toBe(2)
  })

  it('returns length of a clean run', () => {
    const days = ['2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19']
    expect(computeLongestStreak(days)).toBe(5)
  })

  it('picks the longer of two separate runs separated by a big gap', () => {
    const days = ['2026-07-10', '2026-07-11', '2026-07-20', '2026-07-21']
    expect(computeLongestStreak(days)).toBe(2)
  })
})
