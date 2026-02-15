'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import { useAdminMode } from '@/hooks/useAdminMode'
import BottomNav from '@/components/ui/BottomNav'
import AdminModeToggle from '@/components/ui/AdminModeToggle'
import BalanceBoard from '@/components/board/BalanceBoard'
import type { MemberBalance } from '@/types'

export default function BoardPage() {
  const router = useRouter()
  const { session, loading, logout } = useSession()
  const { adminMode, setAdminMode, loaded: adminLoaded } = useAdminMode()
  const [balances, setBalances] = useState<MemberBalance[]>([])
  const [loadingData, setLoadingData] = useState(true)

  const fetchBalances = useCallback(async () => {
    if (!session) return
    try {
      const res = await fetch(`/api/balances?groupId=${session.groupId}`, { cache: 'no-store' })
      if (res.ok) setBalances(await res.json())
    } finally {
      setLoadingData(false)
    }
  }, [session])

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/')
      return
    }
    if (session) fetchBalances()
  }, [session, loading, router, fetchBalances])

  async function handleRemoveMember(memberId: string) {
    if (!session || !confirm('Remove this member? Their expenses will also be deleted.')) return
    await fetch('/api/members', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, adminId: session.memberId }),
    })
    await fetchBalances()
  }

  if (loading || !adminLoaded) {
    return <div className="phone-frame flex items-center justify-center min-h-dvh text-ink-muted">Loading...</div>
  }

  if (!session) return null

  return (
    <div className="phone-frame pb-20">
      <header className="sticky top-0 bg-white/80 backdrop-blur-sm border-b border-border z-10 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-lg">Balance Board</h1>
            <p className="text-xs text-ink-muted">
              {session.name}
              <button onClick={logout} className="ml-2 text-accent hover:underline">
                Not you?
              </button>
            </p>
          </div>
        </div>
        {session.isAdmin && (
          <div className="mt-2">
            <AdminModeToggle adminMode={adminMode} setAdminMode={setAdminMode} />
          </div>
        )}
      </header>

      <main className="p-4">
        {loadingData ? (
          <p className="text-center text-ink-muted py-12">Loading balances...</p>
        ) : (
          <BalanceBoard
            balances={balances}
            currency={session.currency}
            currentMemberId={session.memberId}
            isAdmin={session.isAdmin && adminMode}
            onRemoveMember={handleRemoveMember}
          />
        )}
      </main>

      <BottomNav active="board" isAdmin={session.isAdmin} />
    </div>
  )
}
