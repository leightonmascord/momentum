// Live presence across ALL of a user's groups — subscribes to every group's
// presence subcollection and returns a Map<groupId, GroupPresence[]> with
// elapsedSeconds ticked every second.
import { useEffect, useMemo, useRef, useState } from 'react'
import { groupService } from './group-service'
import type { GroupPresence } from '../domain/cloud-types'

export type AllGroupsPresence = Map<string, GroupPresence[]>

/**
 * Subscribes to live presence records for every group the user belongs to.
 * Returns a Map keyed by groupId.  Entries for groups with no active members
 * are omitted.  Returns an empty Map when uid is null or has no groups.
 *
 * If `filterUid` is provided, presence records for that uid are excluded from
 * the returned map (so group presence shows "other people studying").
 */
export function useAllGroupsPresence(uid: string | null, filterUid?: string | null): AllGroupsPresence {
  const unsubscribes = useRef<(() => void)[]>([])

  // Bumped every second so elapsedSeconds ticks
  const [, setTick] = useState(0)

  // Use a ref for the presence map so we don't re-render on every Firestore update,
  // only re-render when the count of records actually changes (to trigger tick).
  const presenceMapRef = useRef<AllGroupsPresence>(new Map())

  useEffect(() => {
    // Tear down old subscriptions
    unsubscribes.current.forEach((u) => u())
    unsubscribes.current = []
    presenceMapRef.current = new Map()
    setTick((t) => t + 1) // Trigger render for empty state

    if (!uid) return

    let cancelled = false
    groupService.listMyGroups(uid).then((groups) => {
      if (cancelled) return
      // Subscribe to each group's presence
      const snapshots: Record<string, GroupPresence[]> = {}
      const failedGroups = new Set<string>()
      for (const g of groups) {
        const unsub = groupService.subscribePresence(g.id, (records) => {
          // Filter out the current user's own presence if requested
          if (failedGroups.has(g.id)) return
          const filtered = filterUid
            ? records.filter((r) => r.uid !== filterUid)
            : records
          snapshots[g.id] = filtered
          if (!cancelled) {
            presenceMapRef.current = new Map(Object.entries(snapshots))
            setTick((t) => t + 1) // Re-render when data updates
          }
        })
        // Wrap unsub so a permission error on this group also removes it
        // from the snapshots map.
        const wrappedUnsub = () => {
          failedGroups.add(g.id)
          delete snapshots[g.id]
          if (!cancelled) {
            presenceMapRef.current = new Map(Object.entries(snapshots))
            setTick((t) => t + 1)
          }
          unsub()
        }
        unsubscribes.current.push(wrappedUnsub)
      }
    })

    return () => {
      cancelled = true
      unsubscribes.current.forEach((u) => u())
      unsubscribes.current = []
    }
  }, [uid, filterUid])

  const presenceMap = presenceMapRef.current

  // Total active presence records across all groups — drives the tick interval.
  const activeCount = useMemo(
    () => Array.from(presenceMap.values()).reduce((sum, r) => sum + r.length, 0),
    [presenceMap],
  )

  // Tick every second to re-derive elapsedSeconds while anyone is studying.
  useEffect(() => {
    if (activeCount === 0) return
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [activeCount])

  // Re-derive elapsedSeconds from wall clock
  if (activeCount === 0) return presenceMap
  const now = Date.now()
  const ticked: AllGroupsPresence = new Map()
  for (const [groupId, records] of presenceMap) {
    if (records.length === 0) continue
    ticked.set(
      groupId,
      records.map((r) => ({ ...r, elapsedSeconds: Math.floor((now - r.startedAt) / 1000) })),
    )
  }
  return ticked
}
