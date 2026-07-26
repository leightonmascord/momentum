// Group service for Firebase cloud groups.
// Handles group create, join, leave, member management, invite codes, presence, and timer sync.
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  runTransaction,
  onSnapshot,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import { isoNow } from './utils'
import type { Group, GroupMember, GroupPresence } from '../domain/cloud-types'
import type { PersistedTimerState } from './timer-persistence'

function genInviteCode(): string {
  // 6-char alphanumeric, no ambiguous chars
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

export const groupService = {
  /** Create a new group. Caller becomes the owner. */
  async createGroup(
    name: string,
    description: string,
    uid: string,
    displayName: string,
    photoURL: string | null
  ): Promise<Group> {
    if (!isFirebaseConfigured || !db) throw new Error('Firebase not configured')
    const now = isoNow()
    let inviteCode = genInviteCode()
    for (let i = 0; i < 5; i++) {
      const ref = doc(db, 'groups', inviteCode)
      const snap = await getDoc(ref)
      if (!snap.exists()) break
      inviteCode = genInviteCode()
    }
    const group: Group = {
      id: inviteCode,
      name,
      description: description || '',
      inviteCode,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
      memberCount: 1,
    }
    await setDoc(doc(db, 'groups', inviteCode), group)
    const member: GroupMember = {
      groupId: inviteCode,
      uid,
      displayName,
      photoURL,
      joinedAt: now,
      role: 'owner',
    }
    await setDoc(doc(db, 'groupMembers', `${inviteCode}_${uid}`), member)
    return group
  },

  /** Join a group by invite code. */
  async joinGroup(
    inviteCode: string,
    uid: string,
    displayName: string,
    photoURL: string | null
  ): Promise<Group> {
    if (!isFirebaseConfigured || !db) throw new Error('Firebase not configured')
    const groupRef = doc(db, 'groups', inviteCode)
    const groupSnap = await getDoc(groupRef)
    if (!groupSnap.exists()) throw new Error('Invalid invite code')
    const group = groupSnap.data() as Group
    const memberRef = doc(db, 'groupMembers', `${inviteCode}_${uid}`)
    const memberSnap = await getDoc(memberRef)
    if (memberSnap.exists()) return group
    const now = isoNow()
    const member: GroupMember = {
      groupId: inviteCode,
      uid,
      displayName,
      photoURL,
      joinedAt: now,
      role: 'member',
    }
    await runTransaction(db, async (tx) => {
      tx.set(memberRef, member)
      tx.update(groupRef, {
        memberCount: group.memberCount + 1,
        updatedAt: now,
      })
    })
    return { ...group, memberCount: group.memberCount + 1 }
  },

  /** Leave a group. */
  async leaveGroup(groupId: string, uid: string) {
    if (!isFirebaseConfigured || !db) throw new Error('Firebase not configured')
    const groupRef = doc(db, 'groups', groupId)
    const memberRef = doc(db, 'groupMembers', `${groupId}_${uid}`)
    const groupSnap = await getDoc(groupRef)
    const memberSnap = await getDoc(memberRef)
    if (!groupSnap.exists() || !memberSnap.exists()) return
    const group = groupSnap.data() as Group
    await runTransaction(db, async (tx) => {
      tx.delete(memberRef)
      if (group.memberCount > 1) {
        tx.update(groupRef, {
          memberCount: group.memberCount - 1,
          updatedAt: isoNow(),
        })
      } else {
        tx.delete(groupRef)
      }
    })
  },

  /** Delete a group (owner only). */
  async deleteGroup(groupId: string) {
    if (!isFirebaseConfigured || !db) throw new Error('Firebase not configured')
    const members = await this.listMembers(groupId)
    for (const m of members) {
      await deleteDoc(doc(db, 'groupMembers', `${groupId}_${m.uid}`))
    }
    await deleteDoc(doc(db, 'groups', groupId))
  },

  /** Get a group by id. */
  async getGroup(groupId: string): Promise<Group | null> {
    if (!isFirebaseConfigured || !db) return null
    const snap = await getDoc(doc(db, 'groups', groupId))
    return snap.exists() ? (snap.data() as Group) : null
  },

  /** List all groups the user is a member of. */
  async listMyGroups(uid: string): Promise<Group[]> {
    if (!isFirebaseConfigured || !db) return []
    const q = query(collection(db, 'groupMembers'), where('uid', '==', uid))
    const snap = await Promise.race([
      getDocs(q),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out')), 10000)
      ),
    ])
    const groupIds = snap.docs.map((d) => (d.data() as GroupMember).groupId)
    const groups: Group[] = []
    for (const id of groupIds) {
      try {
        const g = await this.getGroup(id)
        if (g) groups.push(g)
      } catch (e) {
        console.warn(`Failed to load group ${id}:`, e)
      }
    }
    return groups
  },

  /** List members of a group. */
  async listMembers(groupId: string): Promise<GroupMember[]> {
    if (!isFirebaseConfigured || !db) return []
    const q = query(collection(db, 'groupMembers'), where('groupId', '==', groupId))
    const snap = await getDocs(q)
    return snap.docs.map((d) => d.data() as GroupMember)
  },

  /** Get a single member's record. */
  async getMember(groupId: string, uid: string): Promise<GroupMember | null> {
    if (!isFirebaseConfigured || !db) return null
    const snap = await getDoc(doc(db, 'groupMembers', `${groupId}_${uid}`))
    return snap.exists() ? (snap.data() as GroupMember) : null
  },

  /** Write studying presence to all of the user's groups */
  async updatePresence(uid: string, displayName: string, subjectName: string): Promise<void> {
    if (!isFirebaseConfigured || !db) return
    const memberGroups = await this.listMyGroups(uid)
    const data = { uid, displayName, subjectName, startedAt: Date.now(), updatedAt: Date.now() }
    await Promise.allSettled(
      memberGroups.map((g) => setDoc(doc(db!, 'groups', g.id, 'presence', uid), data))
    )
  },

  /** Clear studying presence from all of the user's groups */
  async clearPresence(uid: string): Promise<void> {
    if (!isFirebaseConfigured || !db) return
    const memberGroups = await this.listMyGroups(uid)
    await Promise.allSettled(
      memberGroups.map((g) => deleteDoc(doc(db!, 'groups', g.id, 'presence', uid)))
    )
  },

  /** Persist timer state to Firestore for cross-tab/device sync. */
  async saveTimer(uid: string, state: PersistedTimerState): Promise<void> {
    if (!isFirebaseConfigured || !db) return
    await setDoc(doc(db, 'timerState', uid), { ...state, updatedAt: Date.now() }, { merge: true })
  },

  /** Subscribe to a user's timer state. */
  subscribeTimer(uid: string, callback: (state: PersistedTimerState | null) => void): () => void {
    if (!isFirebaseConfigured || !db) return () => {}
    return onSnapshot(
      doc(db, 'timerState', uid),
      (snap) => {
        if (!snap.exists()) {
          callback(null)
          return
        }
        callback(snap.data() as PersistedTimerState)
      },
      (err) => {
        console.warn('Timer subscription error:', err)
      },
    )
  },

  /** Subscribe to live presence for a group. Returns an unsubscribe function. */
  subscribePresence(groupId: string, callback: (records: GroupPresence[]) => void): () => void {
    if (!isFirebaseConfigured || !db) return () => {}
    let innerUnsub: (() => void) | null = null
    const errorUnsub = (err: unknown) => {
      // Auto-unsubscribe on permission errors so the SDK stops retrying
      // and the console doesn't fill with the same error. Group was deleted
      // or the user was removed — either way, we can't read this anymore.
      console.warn('Presence subscription error:', err)
      innerUnsub?.()
      innerUnsub = null
    }
    innerUnsub = onSnapshot(
      collection(db!, 'groups', groupId, 'presence'),
      (snap) => {
        const records: GroupPresence[] = []
        const now = Date.now()
        for (const d of snap.docs) {
          const data = d.data() as GroupPresence
          if (now - data.updatedAt > 5 * 60_000) continue
          records.push({ ...data, elapsedSeconds: Math.floor((now - data.startedAt) / 1000) })
        }
        callback(records)
      },
      errorUnsub
    )
    return () => { innerUnsub?.() }
  },
}
