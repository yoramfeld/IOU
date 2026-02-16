'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { getSession, setSession, clearSession } from '@/lib/session'
import type { MemberSession } from '@/types'

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
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setSessionState(getSession())
    setLoading(false)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  async function createGroup(groupName: string, currency: string, memberName: string): Promise<MemberSession | null> {
    const res = await fetch('/api/auth/create-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName, currency, memberName }),
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
    setSession(s)
    setSessionState(s)
    return s
  }

  async function joinGroup(groupCode: string, memberName: string): Promise<{ ok: boolean; error?: string; verification?: VerificationData }> {
    const res = await fetch('/api/auth/join-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupCode, memberName }),
    })
    const data = await res.json()

    if (!res.ok && !data.needsVerification) {
      return { ok: false, error: data.error || 'Failed to join group' }
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
    setSession(s)
    setSessionState(s)
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
          setSession(s)
          setSessionState(s)
          resolve(s)
        } catch {
          // network error, keep polling
        }
      }, 3000)
    })
  }, [])

  function updateSession(updates: Partial<MemberSession>) {
    if (!session) return
    const updated = { ...session, ...updates }
    setSession(updated)
    setSessionState(updated)
  }

  function logout() {
    clearSession()
    setSessionState(null)
  }

  return { session, loading, createGroup, joinGroup, claimSession, updateSession, logout }
}
