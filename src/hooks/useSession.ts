'use client'

import { useState, useEffect } from 'react'
import { getSession, setSession, clearSession } from '@/lib/session'
import type { MemberSession } from '@/types'

export function useSession() {
  const [session, setSessionState] = useState<MemberSession | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setSessionState(getSession())
    setLoading(false)
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

  async function joinGroup(groupCode: string, memberName: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/api/auth/join-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupCode, memberName }),
    })
    if (!res.ok) {
      const err = await res.json()
      return { ok: false, error: err.error || 'Failed to join group' }
    }
    const data = await res.json()

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

  return { session, loading, createGroup, joinGroup, updateSession, logout }
}
