'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import BottomNav from '@/components/ui/BottomNav'
import GroupSettings from '@/components/settings/GroupSettings'

export default function SettingsPage() {
  const router = useRouter()
  const { session, loading, logout, updateSession } = useSession()

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/')
      return
    }
    if (!loading && session && !session.isAdmin) {
      router.replace('/expenses')
    }
  }, [session, loading, router])

  async function handleUpdate(updates: { name?: string; currency?: string }): Promise<{ ok: boolean; error?: string }> {
    if (!session) return { ok: false, error: 'Not logged in' }

    const res = await fetch('/api/groups', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: session.groupId,
        adminId: session.memberId,
        ...updates,
      }),
    })

    if (!res.ok) {
      const err = await res.json()
      return { ok: false, error: err.error }
    }

    // Update local session
    const sessionUpdates: Record<string, string> = {}
    if (updates.name) sessionUpdates.groupName = updates.name
    if (updates.currency) sessionUpdates.currency = updates.currency
    if (Object.keys(sessionUpdates).length > 0) {
      updateSession(sessionUpdates)
    }

    return { ok: true }
  }

  if (loading) {
    return <div className="phone-frame flex items-center justify-center min-h-dvh text-ink-muted">Loading...</div>
  }

  async function handleReset() {
    if (!session) return
    if (!confirm('This will permanently delete ALL expenses and settlements. Balances will be reset to zero. Continue?')) return

    const res = await fetch('/api/expenses', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: session.groupId,
        adminId: session.memberId,
        resetAll: true,
      }),
    })

    if (!res.ok) {
      const data = await res.json()
      alert(data.error || 'Failed to reset')
      return
    }

    alert('All transactions have been reset.')
    window.location.href = '/board'
  }

  if (!session || !session.isAdmin) return null

  return (
    <div className="phone-frame pb-20">
      <header className="sticky top-0 bg-white/80 backdrop-blur-sm border-b border-border z-10 px-4 py-3">
        <div>
          <h1 className="font-bold text-lg">Settings</h1>
          <p className="text-xs text-ink-muted">
            {session.name}
            <button onClick={logout} className="ml-2 text-accent hover:underline">
              Not you?
            </button>
          </p>
        </div>
      </header>

      <main className="p-4">
        <GroupSettings session={session} onUpdate={handleUpdate} />

        <div className="mt-8 pt-6 border-t border-border">
          <h2 className="text-sm font-semibold text-red mb-1">Danger zone</h2>
          <p className="text-xs text-ink-muted mb-3">
            Delete all expenses and settlements. Members will be kept.
          </p>
          <button onClick={handleReset} className="btn bg-red text-white hover:bg-red/90">
            Reset all transactions
          </button>
        </div>
      </main>

      <BottomNav active="settings" isAdmin={session.isAdmin} />
    </div>
  )
}
