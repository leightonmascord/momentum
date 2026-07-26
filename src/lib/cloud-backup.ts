/**
 * Cloud Backup: 3-day rolling snapshot system.
 *
 * On each app load, if today's snapshot doesn't exist, we read every synced
 * table from the local Dexie DB and write a single Firestore document under
 * `userBackups/{uid}/backups/{YYYY-MM-DD}`. Snapshots older than 3 days
 * are pruned. A full list of snapshots is available for the user to browse
 * and restore from.
 */
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  orderBy,
  query,
  limit as firestoreLimit,
} from 'firebase/firestore'
import { db as firestore, isFirebaseConfigured } from './firebase'
import { db as localDb } from '../db/app-db'
import { isoNow } from './utils'
import type { AppData } from '../app/providers'

type TableKey = Extract<keyof AppData, string>

const BACKUP_COLLECTION = 'userBackups'
const RETENTION_DAYS = 3

const SYNC_TABLES: TableKey[] = [
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

function todayKey(): string {
  return new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'
}

function dateNDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export interface BackupMeta {
  date: string // 'YYYY-MM-DD'
  totalRecords: number
  tables: Record<string, number>
  createdAt: string
}

function backupDocRef(uid: string, date: string) {
  return doc(firestore!, BACKUP_COLLECTION, uid, 'backups', date)
}

function backupsColRef(uid: string) {
  return collection(firestore!, BACKUP_COLLECTION, uid, 'backups')
}

/** Read all synced tables from local Dexie and snapshot to today's backup. */
export async function createBackup(uid: string): Promise<BackupMeta> {
  if (!isFirebaseConfigured || !firestore) throw new Error('Firebase not configured')
  const today = todayKey()
  const data: Record<string, unknown[]> = {}
  let totalRecords = 0

  for (const tableKey of SYNC_TABLES) {
    const rows = (await localDb.table(tableKey).toArray()) as unknown[]
    data[tableKey] = rows
    totalRecords += rows.length
  }

  const meta: BackupMeta = {
    date: today,
    totalRecords,
    tables: Object.fromEntries(SYNC_TABLES.map((k) => [k, (data[k] as unknown[]).length])),
    createdAt: isoNow(),
  }

  const snapDoc = backupDocRef(uid, today)
  await setDoc(snapDoc, {
    ...data,
    _meta: meta,
  })

  console.log(`[backup] Created snapshot for ${today}: ${totalRecords} records`)
  return meta
}

/** Delete backups older than RETENTION_DAYS. */
async function pruneOldBackups(uid: string): Promise<number> {
  const cutoff = dateNDaysAgo(RETENTION_DAYS)
  let pruned = 0
  try {
    const q = query(backupsColRef(uid), orderBy('__name__', 'desc'))
    const snap = await getDocs(q)
    for (const docSnap of snap.docs) {
      if (docSnap.id < cutoff) {
        await deleteDoc(docSnap.ref)
        pruned++
        console.log(`[backup] Pruned old snapshot ${docSnap.id}`)
      }
    }
  } catch (e) {
    console.warn('[backup] Failed to prune old backups:', e)
  }
  return pruned
}

/** Ensure today's backup exists. Called on every app load. */
export async function ensureDailyBackup(uid: string): Promise<boolean> {
  if (!isFirebaseConfigured || !firestore) return false
  try {
    const existing = await getDoc(backupDocRef(uid, todayKey()))
    if (existing.exists()) return false // already backed up today
    await createBackup(uid)
    await pruneOldBackups(uid)
    return true
  } catch (e) {
    console.warn('[backup] ensureDailyBackup failed:', e)
    return false
  }
}

/** List available backups for the user, newest first. */
export async function listBackups(uid: string): Promise<BackupMeta[]> {
  if (!isFirebaseConfigured || !firestore) return []
  try {
    const q = query(backupsColRef(uid), orderBy('__name__', 'desc'), firestoreLimit(RETENTION_DAYS + 2))
    const snap = await getDocs(q)
    return snap.docs.map((d) => d.data()._meta as BackupMeta).filter(Boolean)
  } catch (e) {
    console.warn('[backup] listBackups failed:', e)
    return []
  }
}

/** Restore all tables from a snapshot date. Overwrites the primary cloud doc for each table. */
export async function restoreFromBackup(uid: string, backupDate: string): Promise<number> {
  if (!isFirebaseConfigured || !firestore) throw new Error('Firebase not configured')
  const snapDoc = await getDoc(backupDocRef(uid, backupDate))
  if (!snapDoc.exists()) throw new Error(`No backup found for ${backupDate}`)
  const snapData = snapDoc.data()
  let totalRestored = 0

  for (const tableKey of SYNC_TABLES) {
    const rows = snapData[tableKey]
    if (!Array.isArray(rows)) continue
    // Write to primary cloud doc
    await setDoc(doc(firestore!, 'userData', `${uid}_${tableKey}`), {
      uid,
      tableName: tableKey,
      records: rows,
      updatedAt: isoNow(),
    })
    totalRestored += rows.length
  }

  console.log(`[backup] Restored ${totalRestored} records from ${backupDate}`)
  return totalRestored
}
