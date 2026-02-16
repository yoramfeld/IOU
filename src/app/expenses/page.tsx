'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import { useAdminMode } from '@/hooks/useAdminMode'
import BottomNav from '@/components/ui/BottomNav'
import AdminModeToggle from '@/components/ui/AdminModeToggle'
import ExpenseList from '@/components/expenses/ExpenseList'
import AddExpenseModal from '@/components/expenses/AddExpenseModal'
import type { Expense, ExpenseSplit, Member } from '@/types'

export default function ExpensesPage() {
  const router = useRouter()
  const { session, loading, logout } = useSession()
  const { adminMode, setAdminMode, loaded: adminLoaded } = useAdminMode()
  const [expenses, setExpenses] = useState<(Expense & { splits: ExpenseSplit[] })[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [showModal, setShowModal] = useState(false)
  const [loadingData, setLoadingData] = useState(true)

  const fetchData = useCallback(async () => {
    if (!session) return
    try {
      const t = Date.now()
      const [expRes, memRes] = await Promise.all([
        fetch(`/api/expenses?groupId=${session.groupId}&_t=${t}`),
        fetch(`/api/members?groupId=${session.groupId}&_t=${t}`),
      ])
      if (expRes.ok) setExpenses(await expRes.json())
      if (memRes.ok) setMembers(await memRes.json())
    } finally {
      setLoadingData(false)
    }
  }, [session])

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/')
      return
    }
    if (session) fetchData()
  }, [session, loading, router, fetchData])

  async function handleAddExpense(data: { paidBy: string; amount: number; description: string; splitAmong: string[] }) {
    if (!session) return
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: session.groupId,
        paidBy: data.paidBy,
        amount: data.amount,
        description: data.description,
        splitAmong: data.splitAmong,
        enteredBy: session.memberId,
      }),
    })
    if (!res.ok) throw new Error('Failed')
    await fetchData()
  }

  async function handleDelete(expenseId: string) {
    if (!session || !confirm('Delete this expense?')) return
    await fetch('/api/expenses', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expenseId, adminId: session.memberId }),
    })
    await fetchData()
  }

  // Compute payer's running balance per expense (oldest → newest)
  const payerBalances = useMemo(() => {
    const map: Record<string, number> = {}
    const balances: Record<string, number> = {} // memberId → running balance

    // Expenses are newest-first, iterate in reverse for oldest-first
    for (let i = expenses.length - 1; i >= 0; i--) {
      const exp = expenses[i]
      // Payer gains the full amount
      balances[exp.paid_by] = (balances[exp.paid_by] || 0) + Number(exp.amount)
      // Each split member loses their share
      for (const s of exp.splits) {
        balances[s.member_id] = (balances[s.member_id] || 0) + Number(s.amount) // amount is negative
      }
      map[exp.id] = Math.round((balances[exp.paid_by] || 0) * 100) / 100
    }
    return map
  }, [expenses])

  if (loading || !adminLoaded) {
    return <div className="phone-frame flex items-center justify-center min-h-dvh text-ink-muted">Loading...</div>
  }

  if (!session) return null

  return (
    <div className="phone-frame pb-20">
      <header className="sticky top-0 bg-white/80 backdrop-blur-sm border-b border-border z-10 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-lg">{session.groupName}</h1>
            <p className="text-xs text-ink-muted">
              {session.name}
              <button onClick={logout} className="ml-2 text-accent hover:underline">
                Not you?
              </button>
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="w-10 h-10 bg-accent text-white rounded-full flex items-center justify-center text-xl font-bold shadow-lg"
          >
            +
          </button>
        </div>
        {session.isAdmin && (
          <div className="mt-2">
            <AdminModeToggle adminMode={adminMode} setAdminMode={setAdminMode} />
          </div>
        )}
      </header>

      <main className="p-4">
        {loadingData ? (
          <p className="text-center text-ink-muted py-12">Loading expenses...</p>
        ) : (
          <ExpenseList
            expenses={expenses}
            members={members}
            currency={session.currency}
            isAdmin={session.isAdmin && adminMode}
            onDelete={handleDelete}
            payerBalances={payerBalances}
          />
        )}
      </main>

      {showModal && (
        <AddExpenseModal
          members={members}
          currentMemberId={session.memberId}
          isAdmin={session.isAdmin && adminMode}
          currency={session.currency}
          onSubmit={handleAddExpense}
          onClose={() => setShowModal(false)}
        />
      )}

      <BottomNav active="expenses" isAdmin={session.isAdmin} groupId={session.groupId} />
    </div>
  )
}
