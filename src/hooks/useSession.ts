'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  getSession,
  getSessions,
  addOrUpdateSession,
  setActiveGroup,
  removeSession,
  clearSession,
} from '@/lib/session'
import type { MemberSession, NameCollisionData } from '@/types'

export type { NameCollisionData }

export interface VerificationData {
  pendingId: string
  memberId: string
  code: string
  memberName: string
  groupId: string
  groupName: string
  groupCode: string
  currency: string
}

export function useSession() {
  const [session, setSessionState] = useState<MemberSession | null>(null)
  const [sessions, setSessionsState] = useState<MemberSession[]>([])
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setSessionState(getSession())
    setSessionsState(getSessions())
    setLoading(false)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // Upsert a session and update both state values
  function applySession(s: MemberSession) {
    addOrUpdateSession(s)
    setSessionState(s)
    setSessionsState(getSessions())
  }

  async function createGroup(groupName: string, currency: string, memberName: string, adminPassword?: string): Promise<MemberSession | null> {
    const res = await fetch('/api/auth/create-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName, currency, memberName, adminPassword }),
    })
    if (!res.ok) return null
    const data = await res.json()

    const s: MemberSession = {
      groupId: data.groupId,
      groupName: data.groupName,
      groupCode: data.groupCode,
      currency: data.currency,
      memberId: data.memberId,
      name: data.name,
      isAdmin: true,
    }
    applySession(s)
    return s
  }

  async function joinGroup(
    groupCode: string,
    memberName: string,
    options?: { confirmExisting?: boolean; adminPassword?: string }
  ): Promise<{ ok: boolean; error?: string; verification?: VerificationData; collision?: NameCollisionData }> {
    const res = await fetch('/api/auth/join-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupCode, memberName, ...options }),
    })
    const data = await res.json()

    if (!res.ok && !data.nameCollision && !data.directLogin) {
      return { ok: false, error: data.error || 'Failed to join group' }
    }

    if (data.nameCollision) {
      return { ok: false, collision: { groupName: data.groupName, memberName: data.memberName } }
    }

    if (data.directLogin) {
      const s: MemberSession = {
        groupId: data.groupId,
        groupName: data.groupName,
        groupCode: data.groupCode,
        currency: data.currency,
        memberId: data.memberId,
        name: data.memberName,
        isAdmin: data.isAdmin,
      }
      applySession(s)
      return { ok: true }
    }

    if (data.needsVerification) {
      return {
        ok: false,
        verification: {
          pendingId: data.pendingId,
          memberId: data.memberId,
          code: data.code,
          memberName: data.memberName,
          groupId: data.groupId,
          groupName: data.groupName,
          groupCode: data.groupCode,
          currency: data.currency,
        },
      }
    }

    const s: MemberSession = {
      groupId: data.groupId,
      groupName: data.groupName,
      groupCode: data.groupCode,
      currency: data.currency,
      memberId: data.memberId,
      name: data.name,
      isAdmin: data.isAdmin,
    }
    applySession(s)
    return { ok: true }
  }

  const claimSession = useCallback((verification: VerificationData): Promise<MemberSession> => {
    return new Promise((resolve) => {
      if (pollRef.current) clearInterval(pollRef.current)

      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/auth/verify?pendingId=${verification.pendingId}&memberId=${verification.memberId}`
          )
          if (!res.ok) return
          const data = await res.json()
          if (!data.approved) return

          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null

          const s: MemberSession = {
            groupId: data.groupId,
            groupName: data.groupName,
            groupCode: data.groupCode,
            currency: data.currency,
            memberId: data.memberId,
            name: data.name,
            isAdmin: data.isAdmin,
          }
          applySession(s)
          resolve(s)
        } catch {
          // network error, keep polling
        }
      }, 3000)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateSession(updates: Partial<MemberSession>) {
    if (!session) return
    const updated = { ...session, ...updates }
    applySession(updated)
  }

  function switchGroup(groupId: string) {
    setActiveGroup(groupId)
    const s = getSessions().find(g => g.groupId === groupId) ?? null
    setSessionState(s)
  }

  function logout(groupId?: string) {
    if (groupId) {
      removeSession(groupId)
      const remaining = getSessions()
      setSessionsState(remaining)
      setSessionState(remaining.length > 0 ? getSession() : null)
    } else {
      clearSession()
      setSessionState(null)
      setSessionsState([])
    }
  }

  return { session, sessions, loading, createGroup, joinGroup, claimSession, updateSession, switchGroup, logout }
}
