// Cross-tab coordination for the study timer.
//
// Without a lock, every Momentum tab watches the same `momentum-timer-state`
// entry in localStorage. Each tab independently re-arms the timer using the
// stored `startedAt`, so opening a new tab appears to "start" a fresh timer.
// If the user stops the timer in either tab, both tabs save a session —
// duplicating the study block.
//
// `useTimerTabLock` elects a single owner for the running timer:
//
//   - A single `momentum-timer-owner` key in localStorage holds the owning
//     tab's id. Only the owner broadcasts heartbeats over a BroadcastChannel.
//   - A new tab reads the owner key. If the owner is alive (recent heartbeat)
//     the new tab defers: it renders the timer read-only and never saves.
//   - If the owner is dead (no heartbeat for 6 s — tab closed, browser
//     suspended, crash) any tab may reclaim ownership by writing its own id.
//   - When the owner stops the timer it broadcasts `release` and clears the
//     owner key, so a later tab can reclaim.
import { useEffect, useRef, useState } from 'react'

const CHANNEL_NAME = 'momentum-timer-tab-lock'
const OWNER_KEY = 'momentum-timer-owner'
const HEARTBEAT_INTERVAL_MS = 2_000
const HEARTBEAT_STALE_MS = 6_000

function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function isBroadcastChannelSupported(): boolean {
  return typeof BroadcastChannel !== 'undefined'
}

interface BroadcastMessage {
  type: 'heartbeat' | 'release'
  tabId: string
  ts: number
}

export interface UseTimerTabLockResult {
  /** True when this tab is the sole owner of the timer and may save sessions. */
  isOwner: boolean
  /** True when the timer is owned by another live tab — render read-only. */
  isOwnedElsewhere: boolean
}

export function useTimerTabLock(isLocalRunning: boolean): UseTimerTabLockResult {
  const myTabIdRef = useRef<string>(shortId())
  const channelRef = useRef<BroadcastChannel | null>(null)
  const lastPeerTsRef = useRef<number>(0)
  const lastPeerTabIdRef = useRef<string>('')
  const [peerTs, setPeerTs] = useState<number>(0)
  const [ownerId, setOwnerId] = useState<string | null>(() => {
    if (typeof localStorage === 'undefined') return null
    try { return localStorage.getItem(OWNER_KEY) } catch { return null }
  })

  // Claim ownership: write our id to localStorage and broadcast a heartbeat.
  function claim() {
    const id = myTabIdRef.current
    try { localStorage.setItem(OWNER_KEY, id) } catch { /* ignore */ }
    setOwnerId(id)
    try {
      channelRef.current?.postMessage({ type: 'heartbeat', tabId: id, ts: Date.now() } satisfies BroadcastMessage)
    } catch { /* ignore */ }
  }

  // Release ownership when the timer stops.
  useEffect(() => {
    if (isLocalRunning) return
    const id = myTabIdRef.current
    if (ownerId === id) {
      try { localStorage.removeItem(OWNER_KEY) } catch { /* ignore */ }
      setOwnerId(null)
      try {
        channelRef.current?.postMessage({ type: 'release', tabId: id, ts: Date.now() } satisfies BroadcastMessage)
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocalRunning])

  // Open the channel once.
  useEffect(() => {
    if (!isBroadcastChannelSupported()) return
    const ch = new BroadcastChannel(CHANNEL_NAME)
    channelRef.current = ch
    ch.onmessage = (ev: MessageEvent<BroadcastMessage>) => {
      const data = ev.data
      if (!data || data.tabId === myTabIdRef.current) return
      if (data.type === 'heartbeat') {
        lastPeerTsRef.current = data.ts
        lastPeerTabIdRef.current = data.tabId
        setPeerTs(data.ts)
      } else if (data.type === 'release' && data.tabId === lastPeerTabIdRef.current) {
        lastPeerTsRef.current = 0
        lastPeerTabIdRef.current = ''
        setPeerTs(0)
      }
    }
    return () => {
      ch.close()
      channelRef.current = null
    }
  }, [])

  // Ownership decision:
  //   - If the timer is not running locally, we are not the owner.
  //   - If a live peer owns the timer (owner key set to a live tab), defer.
  //   - Otherwise, if the timer is running locally, we are the owner.
  const peerStale = Date.now() - lastPeerTsRef.current > HEARTBEAT_STALE_MS
  const ownerIsLive = !!ownerId && ownerId !== myTabIdRef.current && !peerStale
  const isOwner = isLocalRunning && !ownerIsLive
  const isOwnedElsewhere = ownerIsLive

  // When the timer is running and we are the owner, broadcast heartbeats.
  useEffect(() => {
    if (!isBroadcastChannelSupported()) return
    if (!isLocalRunning || !isOwner) return
    function beat() {
      try {
        channelRef.current?.postMessage({ type: 'heartbeat', tabId: myTabIdRef.current, ts: Date.now() } satisfies BroadcastMessage)
      } catch { /* ignore */ }
    }
    beat()
    const timer = window.setInterval(beat, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [isLocalRunning, isOwner])

  // If the owner key is set but the owner is dead, reclaim ownership.
  useEffect(() => {
    if (!isLocalRunning) return
    if (!ownerId || ownerId === myTabIdRef.current) return
    if (peerStale) claim()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerTs, isLocalRunning])

  // Re-render periodically so `peerStale` recomputes.
  useEffect(() => {
    if (!isLocalRunning) return
    const t = window.setInterval(() => setPeerTs(Date.now()), HEARTBEAT_STALE_MS)
    return () => clearInterval(t)
  }, [isLocalRunning])

  return { isOwner, isOwnedElsewhere }
}
