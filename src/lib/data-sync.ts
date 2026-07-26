// Full data sync: mirrors local Dexie tables ↔ Firestore user/{uid}/data/{table}.
// On sign-in, pulls cloud data and merges into local DB.
// On mutations, pushes changed records to Firestore.
import { recordWrites, hasBudgetFor, warnIfNearLimit, resetIfNewDay } from './write-budget'
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { db as firestore, isFirebaseConfigured } from './firebase'
import { db as localDb } from '../db/app-db'
import { isoNow } from './utils'
import { syncStatus } from './sync-status'
import type { AppData } from '../app/providers'

type TableKey = Extract<keyof AppData, string>

const DATA_COLLECTION = 'userData'
/** Firestore rejects `undefined` field values. Strip them recursively before setDoc. */
function stripUndefined<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) {
    return value.map(stripUndefined) as unknown as T
  }
  if (typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v)
    }
    return out as T
  }
  return value
}


/** All table names to sync. */
export const SYNC_TABLES: TableKey[] = [
  'categories',
  'subjects',
  'projects',
  'sessions',
  'progressLogs',
  'marks',
  'assignments',
  'habits',
  'habitLogs',
  'streakDays',
  'routines',
  'routineLogs',
  'activities',
  'activityLogs',
  'studyAreas',
  'studyReviews',
]

interface CloudTableDoc {
  uid: string
  tableName: string
  records: unknown[]
  updatedAt: string
}

// ────────── Pull: Firestore → local Dexie ──────────

/** Pull all synced tables from Firestore and write to local DB. Returns count of records written. */
export async function pullAllData(uid: string): Promise<number> {
  if (!isFirebaseConfigured || !firestore) return 0
  let total = 0

  beginSync()
  try {
    for (const tableKey of SYNC_TABLES) {
      try {
        const snap = await getDoc(doc(firestore, DATA_COLLECTION, `${uid}_${tableKey}`))
        if (!snap.exists()) continue
        const cloudDoc = snap.data() as CloudTableDoc
        if (!Array.isArray(cloudDoc.records) || cloudDoc.records.length === 0) continue

        const table = localDb.table(tableKey)
        // Merge: only overwrite local records if cloud record is newer (or local doesn't exist)
        const cloudRecords = cloudDoc.records as { id: string; updatedAt?: string }[]
        const localRecords = await table.toArray()
        const localMap = new Map(localRecords.map((r) => [r.id, r as { id: string; updatedAt?: string }]))
        const toWrite: { id: string; updatedAt?: string }[] = []
        for (const cloudRec of cloudRecords) {
          const local = localMap.get(cloudRec.id)
          if (!local) {
            toWrite.push(cloudRec)
          } else {
            const cloudTime = cloudRec.updatedAt ?? ''
            const localTime = local.updatedAt ?? ''
            if (cloudTime > localTime) toWrite.push(cloudRec)
          }
        }
        if (toWrite.length > 0) {
          await table.bulkPut(toWrite)
          total += toWrite.length
        }
      } catch (e) {
        console.warn(`Failed to pull table ${tableKey}:`, e)
      }
    }
  } finally {
    endSync()
  }
  return total
}
export async function forcePullAllData(uid: string): Promise<number> {
  if (!isFirebaseConfigured || !firestore) return 0
  let total = 0
  beginSync()
  try {
    for (const tableKey of SYNC_TABLES) {
      try {
        const snap = await getDoc(doc(firestore, DATA_COLLECTION, `${uid}_${tableKey}`))
        if (!snap.exists()) continue
        const cloudDoc = snap.data() as CloudTableDoc
        if (!Array.isArray(cloudDoc.records) || cloudDoc.records.length === 0) continue
        const table = localDb.table(tableKey)
        // FORCE: replace the entire table with the cloud copy. Use bulkPut to
        // upsert all cloud records. This does NOT delete records that are
        // missing from cloud — those remain in local.
        const cloudRecords = cloudDoc.records as { id: string }[]
        await table.bulkPut(cloudRecords)
        total += cloudRecords.length
        console.log(`[sync] Force-pulled ${tableKey}: ${cloudRecords.length} records`)
      } catch (e) {
        console.warn(`Failed to force-pull table ${tableKey}:`, e)
      }
    }
  } finally {
    endSync()
  }
  return total
}

export interface CloudState {
  totalRecords: number
  tables: Record<string, { cloud: number; local: number; deleted?: number }>
  error?: string
}

/** Diagnostic: compare local vs cloud record counts per table. */
export async function checkCloudState(uid: string): Promise<CloudState> {
  const result: CloudState = { totalRecords: 0, tables: {} }
  if (!isFirebaseConfigured || !firestore) {
    result.error = 'Firebase not configured'
    return result
  }
  for (const tableKey of SYNC_TABLES) {
    try {
      const rows = await localDb.table(tableKey).toArray() as Array<{ deletedAt?: string | null }>
      const localCount = rows.length
      const deletedCount = rows.filter((r) => !!r.deletedAt).length
      const snap = await getDoc(doc(firestore, DATA_COLLECTION, `${uid}_${tableKey}`))
      let cloudCount = 0
      if (snap.exists()) {
        const cloudDoc = snap.data() as CloudTableDoc
        if (Array.isArray(cloudDoc.records)) cloudCount = cloudDoc.records.length
      }
      result.tables[tableKey] = { cloud: cloudCount, local: localCount, deleted: deletedCount }
      result.totalRecords += cloudCount
    } catch (e) {
      console.warn(`Failed to check ${tableKey}:`, e)
    }
  }
  return result
}

export async function undeleteAllData(uid?: string): Promise<number> {
  let total = 0
  for (const tableKey of SYNC_TABLES) {
    try {
      const rows = await localDb.table(tableKey).toArray() as Array<{ id: string; deletedAt?: string | null }>
      const toUndelete = rows.filter((r) => r.deletedAt)
      for (const row of toUndelete) {
        await localDb.table(tableKey).update(row.id, { deletedAt: null })
      }
      total += toUndelete.length
      if (toUndelete.length > 0) {
        console.log(`[sync] Undeleted ${toUndelete.length} records in ${tableKey}`)
        // Push the cleaned records to the cloud so the next sync doesn't
        // re-overwrite them with the cloud's soft-deleted version.
        if (uid) {
          try {
            await pushTable(uid, tableKey)
          } catch (e) {
            console.warn(`Failed to push undeleted ${tableKey} to cloud:`, e)
          }
        }
      }
    } catch (e) {
      console.warn(`Failed to undelete in ${tableKey}:`, e)
    }
  }
  return total
}


// ────────── Push: local Dexie → Firestore ──────────

/** Push a single table's entire contents to Firestore. */
export async function pushTable(uid: string, tableKey: TableKey): Promise<void> {
  if (!isFirebaseConfigured || !firestore) {
    throw new Error('Firebase not configured')
  }
  const records = (await localDb.table(tableKey).toArray())
  if (records.length === 0) return
  try {
    if (!hasBudgetFor(1)) {
      syncStatus.notifyFailure('Write quota exceeded')
      return
    }
    warnIfNearLimit()
    await setDoc(doc(firestore, DATA_COLLECTION, `${uid}_${tableKey}`), {
      uid,
      tableName: tableKey,
      records: records.map(stripUndefined),
      updatedAt: isoNow(),
    } satisfies CloudTableDoc)
    console.log(`[sync] Pushed ${tableKey}: ${records.length} records`)
    recordWrites(1)
    syncStatus.notifySuccess()
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const code = err.code ?? 'unknown'
    const message = err.message ?? String(e)
    console.error(`[sync] Failed to push ${tableKey}: ${code} ${message}`)
    if (code === 'resource-exhausted') {
      syncStatus.notifyFailure(`Firestore quota exceeded. Sync paused until tomorrow (UTC)`)
    } else if (code === 'unavailable' || /BLOCKED|offline/i.test(message)) {
      syncStatus.notifyFailure(`Sync blocked. Check that ad-blocker (Brave Shields) is off for this site`)
    } else {
      syncStatus.notifyFailure(`Sync failed for ${tableKey} (${code})`)
    }
    throw e // re-throw so the dirty table isn't cleared
  }
}
export async function pushAllData(uid: string): Promise<void> {
  for (const tableKey of SYNC_TABLES) {
    await pushTable(uid, tableKey)
  }
  console.log(`[sync] Pushed ${SYNC_TABLES.length} tables to cloud`)
}

/** DEPRECATED: per-record push is replaced by debounced table push via markDirty().
 * Kept as a fallback for callers that need an immediate single-record push. */
export async function pushRecord(uid: string, tableKey: TableKey, record: unknown): Promise<void> {
  if (!isFirebaseConfigured || !firestore) return
  try {
    const docId = `${uid}_${tableKey}`
    const snap = await getDoc(doc(firestore, DATA_COLLECTION, docId))
    let records: unknown[] = []
    if (snap.exists()) {
      const existing = snap.data() as CloudTableDoc
      records = Array.isArray(existing.records) ? existing.records : []
    }
    const rec = record as { id: string }
    const idx = records.findIndex((r) => (r as { id: string }).id === rec.id)
    if (idx >= 0) records[idx] = rec
    else records.push(rec)

    await setDoc(doc(firestore, DATA_COLLECTION, docId), {
      uid,
      tableName: tableKey,
      records,
      updatedAt: isoNow(),
    })
  } catch (e) {
    console.warn(`Failed to push record to ${tableKey}:`, e)
  }
}

export async function pushFullBackup(uid: string): Promise<void> {
  await pushAllData(uid)
}

// ────────── Dexie hooks: auto-push on every local mutation ──────────
// Hooks are installed once on module load. The activeSyncUid flag gates
// whether they actually push to Firestore (set on sign-in, cleared on sign-out).

let activeSyncUid: string | null = null
let syncDepth = 0
function beginSync() { syncDepth++ }
function endSync() { syncDepth-- }

/** Disable all sync hooks, cancel pending flush, and persist dirty tables for next session. */
export function uninstallSyncHooks() {
  activeSyncUid = null
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  // Don't drop dirty tables — persist them so they survive sign-out/sign-in cycles
}

// ────────── Debounced push: coalesce rapid mutations into one table push ──────────
// Dirty table keys are persisted to localStorage so they survive page closes.
// On startup, flushDirtyTablesOnLoad() picks up any pending tables.

const DIRTY_KEY = 'momentum-sync-dirty'

function loadDirtyTables(): Set<TableKey> {
  try {
    const raw = localStorage.getItem(DIRTY_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as TableKey[])
  } catch {
    return new Set()
  }
}

function saveDirtyTables(tables: Set<TableKey>) {
  if (tables.size === 0) {
    localStorage.removeItem(DIRTY_KEY)
  } else {
    localStorage.setItem(DIRTY_KEY, JSON.stringify([...tables]))
  }
}

const dirtyTables = loadDirtyTables()
let flushTimer: ReturnType<typeof setTimeout> | null = null
const FLUSH_DELAY = 5000

function markDirty(tableKey: TableKey) {
  if (!activeSyncUid) return
  dirtyTables.add(tableKey)
  saveDirtyTables(dirtyTables)
  if (!flushTimer) {
    flushTimer = setTimeout(flushDirtyTables, FLUSH_DELAY)
  }
}

/** Flush pending dirty tables immediately (used on page close / tab hide).
 * Unlike the previous version, this does NOT clear dirtyTables upfront —
 * only removes entries after a successful push. If the browser kills the
 * process mid-flush, surviving dirty tables remain in localStorage for
 * retry on next startup via flushPendingDirtyTables(). */
export async function flushNow(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (!activeSyncUid || dirtyTables.size === 0) return
  const tables = [...dirtyTables]
  for (const tableKey of tables) {
    try {
      await pushTable(activeSyncUid, tableKey)
      dirtyTables.delete(tableKey)
      saveDirtyTables(dirtyTables)
    } catch (e) {
      console.error(`[sync] Flush failed for ${tableKey}, will retry later`)
    }
  }
}

async function flushDirtyTables() {
  resetIfNewDay()
  flushTimer = null
  if (!activeSyncUid || dirtyTables.size === 0) return
  const tables = [...dirtyTables]
  for (const tableKey of tables) {
    try {
      await pushTable(activeSyncUid, tableKey)
      dirtyTables.delete(tableKey)
      saveDirtyTables(dirtyTables)
    } catch (e) {
      console.error(`[sync] Will retry ${tableKey} later`)
      // Table stays in dirtyTables + localStorage for retry
    }
  }
}

/**
 * On startup: flush any dirty tables that were persisted from a previous session
 * (e.g. if the browser was killed before flushNow completed).
 */
export function flushPendingDirtyTables() {
  if (dirtyTables.size === 0) return
  const uid = localStorage.getItem('momentum-cloud-uid')
  if (!uid) return
  activeSyncUid = uid
  void flushDirtyTables()
}

/** Enable sync hooks for the given user. */
export function installSyncHooks(uid: string) {
  activeSyncUid = uid
  for (const tableKey of SYNC_TABLES) {
    localDb.table(tableKey).hook('creating', () => {
      if (syncDepth > 0 || !activeSyncUid) return
      markDirty(tableKey)
    })
    localDb.table(tableKey).hook('updating', () => {
      if (syncDepth > 0 || !activeSyncUid) return
      markDirty(tableKey)
    })
    localDb.table(tableKey).hook('deleting', () => {
      if (syncDepth > 0 || !activeSyncUid) return
      markDirty(tableKey)
    })
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushNow()
  })
  window.addEventListener('beforeunload', () => {
    void flushNow()
  })
}

/**
 * Subscribe to real-time updates from the cloud.
 * Whenever any synced table changes on the server, pull the change into local DB
 * and dispatch a 'momentum-data-synced' event so the UI refreshes.
 */
export function subscribeToUserData(uid: string): Unsubscribe {
  if (!isFirebaseConfigured || !firestore) {
    console.warn('[sync] Firebase not configured, skipping subscription')
    return () => {}
  }
  console.log(`[sync] Subscribing to ${SYNC_TABLES.length} tables for ${uid}`)
  const unsubscribers: Unsubscribe[] = []
  for (const tableKey of SYNC_TABLES) {
    const docRef = doc(firestore, DATA_COLLECTION, `${uid}_${tableKey}`)
    const unsub = onSnapshot(
      docRef,
      async (snap) => {
        if (!snap.exists()) return
        const cloudDoc = snap.data() as CloudTableDoc
        if (!Array.isArray(cloudDoc.records) || cloudDoc.records.length === 0) return
        console.info(`[sync] Applying ${cloudDoc.records.length} records to ${tableKey}`)
        try {
          beginSync()
          const table = localDb.table(tableKey)
          const cloudRecords = cloudDoc.records as { id: string; updatedAt?: string }[]
          const localRecords = await table.toArray()
          const localMap = new Map(localRecords.map((r) => [r.id, r as { id: string; updatedAt?: string }]))
          const toWrite: { id: string; updatedAt?: string }[] = []
          for (const cloudRec of cloudRecords) {
            const local = localMap.get(cloudRec.id)
            if (!local) {
              toWrite.push(cloudRec)
            } else {
              const cloudTime = cloudRec.updatedAt ?? ''
              const localTime = local.updatedAt ?? ''
              // Only overwrite if cloud is newer — preserves local changes
              // (e.g. soft-deletes) that haven't been pushed yet.
              if (cloudTime > localTime) toWrite.push(cloudRec)
            }
          }
          if (toWrite.length > 0) {
            await table.bulkPut(toWrite)
          }
          window.dispatchEvent(new CustomEvent('momentum-data-synced', { detail: { source: 'cloud' } }))
        } catch (e) {
          console.warn(`[sync] Failed to apply ${tableKey}:`, e)
        } finally {
          endSync()
        }
      },
      (err) => {
        console.warn(`[sync] Snapshot error ${tableKey}:`, err)
      }
    )
    unsubscribers.push(unsub)
  }
  return () => {
    for (const u of unsubscribers) u()
  }
}
