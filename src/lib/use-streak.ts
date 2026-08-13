import { useMemo, useState, useEffect } from 'react';
import { format, subDays, differenceInCalendarDays } from 'date-fns';
import { toLocalDateString } from './utils';
import type { Session } from '../domain/types';

const BEST_STREAK_KEY = 'momentum-best-streak';

/**
 * Computes current streak, longest streak, and best (persisted) streak from sessions.
 *
 * @param sessions - Array of Session objects (typically already filtered to academic & non-deleted)
 * @returns { streak: number, longestStreak: number, bestStreak: number }
 */
export function useStreak(sessions: Session[], previewDates: Set<string> = new Set()) {
  // Current streak: consecutive days up to today. One gap (missed day)
  // is allowed per chain — the next logged day after a gap continues
  // the streak. Two consecutive missed days break it. The `missed`
  // counter MUST reset on a logged day, otherwise after the first gap
  // the chain immediately breaks on any further gap (the old code left
  // `missed` unreset, causing "1 day" then "4 days" flicker).
  const streak = useMemo(() => {
    const daySet = new Set<string>();
    for (const s of sessions) {
      daySet.add(toLocalDateString(s.startAt));
    }
    for (const d of previewDates) daySet.add(d)
    let count = 0;
    let missed = 0;
    let d = new Date();
    while (true) {
      const ds = format(d, 'yyyy-MM-dd');
      if (daySet.has(ds)) {
        count++;
        missed = 0; // Reset after a logged day so the chain can survive one more gap
        d = subDays(d, 1);
      } else {
        missed++;
        if (missed > 1) break;
        d = subDays(d, 1);
      }
    }
    return count;
  }, [sessions, previewDates]);

  // Longest streak ever in the dataset — uses the SAME one-gap-per-chain
  // rule as the current streak above. The current-streak rule resets its
  // gap budget on every logged day, so a chain is any run of logged days
  // where every adjacent gap is <= 2 (i.e. at most one missed day between
  // any two logged days). A gap of 3+ (two or more consecutive missed days)
  // always breaks the chain.
  const longestStreak = useMemo(() => {
    const daySet = new Set<string>();
    for (const s of sessions) {
      daySet.add(toLocalDateString(s.startAt));
    }
    const sortedDays = Array.from(daySet).sort();
    if (sortedDays.length <= 1) return sortedDays.length;
    let max = 0;
    let cur = 1;
    for (let i = 1; i < sortedDays.length; i++) {
      const diff = differenceInCalendarDays(
        new Date(sortedDays[i]),
        new Date(sortedDays[i - 1])
      );
      if (diff <= 2) {
        // diff=1: consecutive day, continue chain.
        // diff=2: one missed day, allowed (gap budget replenishes on the
        //   next logged day, matching the current-streak rule).
        cur++;
      } else {
        // diff >= 3: two or more consecutive missed days break the chain.
        if (cur > max) max = cur;
        cur = 1;
      }
    }
    if (cur > max) max = cur;
    return max;
  }, [sessions]);

  // Persisted best streak, initialized from localStorage
  const [bestStreak, setBestStreak] = useState(() => {
    try {
      const stored = localStorage.getItem(BEST_STREAK_KEY);
      return stored ? Number(stored) : 0;
    } catch {
      return 0;
    }
  });

  // Update best streak if longestStreak exceeds it
  useEffect(() => {
    if (longestStreak > bestStreak) {
      setBestStreak(longestStreak);
      try {
        localStorage.setItem(BEST_STREAK_KEY, String(longestStreak));
      } catch {
        // Ignore storage errors (e.g., private browsing)
      }
    }
  }, [longestStreak, bestStreak]);

  return { streak, longestStreak, bestStreak };
}