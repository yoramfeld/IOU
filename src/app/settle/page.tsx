'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import BottomNav from '@/components/ui/BottomNav'
import SettlementList from '@/components/settle/SettlementList'
import { calculateSettlements } from '@/lib/settle'
import type { MemberBalance, Transfer, Expense, ExpenseSplit, ExpensePayer } from '@/types'

export default function SettlePage() {
  const router = useRouter()
  const { session, loading, logout } = useSession()
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loadingData, setLoadingData] = useState(true)

  const fetchAndSettle = useCallback(async () => {
    if (!session) return
    try {
      const t = Date.now()
      const [balRes, expRes] = await Promise.all([
        fetch(`/api/balances?groupId=${session.groupId}&_t=${t}`),
        fetch(`/api/expenses?groupId=${session.groupId}&_t=${t}`),
      ])
      if (balRes.ok && expRes.ok) {
        const apiBalances: MemberBalance[] = await balRes.json()
        const apiExpenses: (Expense & { splits: ExpenseSplit[]; payers: ExpensePayer[] })[] = await expRes.json()
        // Recompute balances from expenses (same as Board) to avoid stale snapshot from non-atomic inserts
        const paidBy: Record<string, number> = {}
        const owedBy: Record<string, number> = {}
        for (const exp of apiExpenses) {
          for (const p of exp.payers ?? []) paidBy[p.member_id] = (paidBy[p.member_id] ?? 0) + Number(p.amount)
          for (const s of exp.splits ?? []) owedBy[s.member_id] = (owedBy[s.member_id] ?? 0) + Number(s.amount)
        }
        const recomputed = apiBalances.map(b => ({
          ...b,
          total_paid: paidBy[b.id] ?? 0,
          total_owed: owedBy[b.id] ?? 0,
          balance: b.starting_balance + (paidBy[b.id] ?? 0) + (owedBy[b.id] ?? 0),
        }))
        setTransfers(calculateSettlements(recomputed))
      } else if (balRes.ok) {
        const balances: MemberBalance[] = await balRes.json()
        setTransfers(calculateSettlements(balances))
      }
    } finally {
      setLoadingData(false)
    }
  }, [session])

  const handleSettle = useCallback(async (transfer: Transfer) => {
    if (!session) return
    try {
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
        const text = await res.text()
        let msg = 'Failed to record settlement'
        try { msg = JSON.parse(text).error || msg } catch {}
        alert(msg)
        return
      }
      window.location.reload()
    } catch (err) {
      alert(`Settlement error: ${err instanceof Error ? err.message : err}`)
    }
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
            {session.name} · <Link href="/" className="hover:text-accent transition-colors">{session.groupName}</Link>
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

      <BottomNav active="settle" isAdmin={session.isAdmin} groupId={session.groupId} />
    </div>
  )
}
