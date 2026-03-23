import type { MemberSession } from '@/types'

const SESSION_KEY = 'iou_session'

interface StoredSessions {
  active: string
  groups: MemberSession[]
}

function readStored(): StoredSessions | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Migrate old single-session format (has top-level memberId)
    if (parsed.memberId) {
      return { active: parsed.groupId, groups: [parsed as MemberSession] }
    }
    return parsed as StoredSessions
  } catch {
    return null
  }
}

function writeStored(stored: StoredSessions): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(stored))
}

export function getSession(): MemberSession | null {
  const stored = readStored()
  if (!stored) return null
  return stored.groups.find(g => g.groupId === stored.active) ?? stored.groups[0] ?? null
}

export function getSessions(): MemberSession[] {
  return readStored()?.groups ?? []
}

export function addOrUpdateSession(session: MemberSession): void {
  const stored = readStored() ?? { active: session.groupId, groups: [] }
  const idx = stored.groups.findIndex(g => g.groupId === session.groupId)
  if (idx >= 0) {
    stored.groups[idx] = session
  } else {
    stored.groups.push(session)
  }
  stored.active = session.groupId
  writeStored(stored)
}

export function setActiveGroup(groupId: string): void {
  const stored = readStored()
  if (!stored) return
  stored.active = groupId
  writeStored(stored)
}

export function removeSession(groupId: string): void {
  const stored = readStored()
  if (!stored) return
  stored.groups = stored.groups.filter(g => g.groupId !== groupId)
  if (stored.active === groupId) {
    stored.active = stored.groups[0]?.groupId ?? ''
  }
  if (stored.groups.length === 0) {
    localStorage.removeItem(SESSION_KEY)
  } else {
    writeStored(stored)
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

// Kept for internal compatibility
export function setSession(session: MemberSession): void {
  addOrUpdateSession(session)
}
