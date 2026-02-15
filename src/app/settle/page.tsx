'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import BottomNav from '@/components/ui/BottomNav'
import SettlementList from '@/components/settle/SettlementList'
import { calculateSettlements } from '@/lib/settle'
import type { MemberBalance, Transfer } from '@/types'

export default function SettlePage() {
  const router = useRouter()
  const { session, loading, logout } = useSession()
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loadingData, setLoadingData] = useState(true)

  const fetchAndSettle = useCallback(async () => {
    if (!session) return
    try {
      const res = await fetch(`/api/balances?groupId=${session.groupId}`, { cache: 'no-store' })
      if (res.ok) {
        const balances: MemberBalance[] = await res.json()
        setTransfers(calculateSettlements(balances))
      }
    } finally {
      setLoadingData(false)
    }
  }, [session])

  const handleSettle = useCallback(async (transfer: Transfer) => {
    if (!session) return
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: session.groupId,
        paidBy: transfer.from,
        amount: transfer.amount,
        description: `⚡ Settlement: ${transfer.fromName} → ${transfer.toName}`,
        splitAmong: [transfer.to],
        enteredBy: session.memberId,
      }),
    })
    if (!res.ok) {
      const data = await res.json()
      alert(data.error || 'Failed to record settlement')
      return
    }
    await fetchAndSettle()
  }, [session, fetchAndSettle])

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/')
      return
    }
    if (session) fetchAndSettle()
  }, [session, loading, router, fetchAndSettle])

  if (loading) {
    return <div className="phone-frame flex items-center justify-center min-h-dvh text-ink-muted">Loading...</div>
  }

  if (!session) return null

  return (
    <div className="phone-frame pb-20">
      <header className="sticky top-0 bg-white/80 backdrop-blur-sm border-b border-border z-10 px-4 py-3">
        <div>
          <h1 className="font-bold text-lg">Settle Up</h1>
          <p className="text-xs text-ink-muted">
            {session.name}
            <button onClick={logout} className="ml-2 text-accent hover:underline">
              Not you?
            </button>
          </p>
        </div>
      </header>

      <main className="p-4">
        {loadingData ? (
          <p className="text-center text-ink-muted py-12">Calculating...</p>
        ) : (
          <SettlementList
            transfers={transfers}
            currency={session.currency}
            currentMemberId={session.memberId}
            isAdmin={session.isAdmin}
            onSettle={handleSettle}
          />
        )}
      </main>

      <BottomNav active="settle" isAdmin={session.isAdmin} />
    </div>
  )
}
