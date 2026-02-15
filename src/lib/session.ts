import type { MemberSession } from '@/types'

const SESSION_KEY = 'iou_session'

export function getSession(): MemberSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as MemberSession) : null
  } catch {
    return null
  }
}

export function setSession(session: MemberSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}
