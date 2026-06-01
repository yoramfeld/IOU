'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import { useAdminMode } from '@/hooks/useAdminMode'
import BottomNav from '@/components/ui/BottomNav'
import AdminModeToggle from '@/components/ui/AdminModeToggle'
import ExpenseList from '@/components/expenses/ExpenseList'
import AddExpenseModal from '@/components/expenses/AddExpenseModal'
import QRModal from '@/components/ui/QRModal'
import SettleModal from '@/components/settle/SettleModal'
import { calculateSettlements } from '@/lib/settle'
import type { Expense, ExpensePayer, ExpenseSplit, Member, MemberBalance, Transfer } from '@/types'

export default function ExpensesPage() {
  const router = useRouter()
  const { session, loading, logout } = useSession()
  const { adminMode, setAdminMode, loaded: adminLoaded } = useAdminMode()
  const [expenses, setExpenses] = useState<(Expense & { splits: ExpenseSplit[]; payers: ExpensePayer[] })[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [showModal, setShowModal] = useState(false)
  const [showQRModal, setShowQRModal] = useState(false)
  const [showSettleModal, setShowSettleModal] = useState(false)
  const [settleTransfers, setSettleTransfers] = useState<Transfer[]>([])
  const [editingExpense, setEditingExpense] = useState<(Expense & { splits: ExpenseSplit[]; payers?: ExpensePayer[] }) | null>(null)
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

  async function handleAddExpense(data: { paidBy: string; amount: number; description: string; splitAmong: string[]; customSplits?: { memberId: string; amount: number }[]; payers: { memberId: string; amount: number }[]; receiptUrl?: string; rating?: number }) {
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
        customSplits: data.customSplits,
        payers: data.payers,
        enteredBy: session.memberId,
        receiptUrl: data.receiptUrl,
        rating: data.rating,
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

  async function handleEditExpense(data: { paidBy: string; amount: number; description: string; splitAmong: string[]; customSplits?: { memberId: string; amount: number }[]; payers: { memberId: string; amount: number }[]; rating?: number }) {
    if (!session || !editingExpense) return
    const res = await fetch('/api/expenses', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expenseId: editingExpense.id,
        adminId: session.memberId,
        description: data.description,
        amount: data.amount,
        payers: data.payers,
        splitAmong: data.splitAmong,
        customSplits: data.customSplits,
        rating: data.rating,
      }),
    })
    if (!res.ok) throw new Error('Failed')
    await fetchData()
  }

  function startEditExpense(expense: Expense & { splits: ExpenseSplit[]; payers?: ExpensePayer[] }) {
    setEditingExpense(expense)
    setShowModal(true)
  }

  async function openSettleModal() {
    if (!session) return
    setShowSettleModal(true)
    const t = Date.now()
    const [balRes, expRes] = await Promise.all([
      fetch(`/api/balances?groupId=${session.groupId}&_t=${t}`),
      fetch(`/api/expenses?groupId=${session.groupId}&_t=${t}`),
    ])
    if (balRes.ok && expRes.ok) {
      const apiBalances: MemberBalance[] = await balRes.json()
      const apiExpenses: (Expense & { splits: ExpenseSplit[]; payers: ExpensePayer[] })[] = await expRes.json()
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
      const all = calculateSettlements(recomputed)
      setSettleTransfers(all.filter(t => t.to === session.memberId))
    }
  }

  async function handleConfirmSettlement(transfer: Transfer) {
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
        payers: [{ memberId: transfer.from, amount: transfer.amount }],
      }),
    })
    if (!res.ok) throw new Error('Failed')
    await fetchData()
    await openSettleModal()
  }

  // Compute running balance per member: each card shows the payer's balance *after* that expense
  const { payerBalances, memberBalances } = useMemo(() => {
    const balances: Record<string, number> = {}

    // Seed with starting balances
    for (const m of members) {
      const sb = Number((m as Member & { starting_balance?: number | string }).starting_balance || 0)
      if (sb) balances[m.id] = sb
    }

    // Expenses are ordered DESC (newest first) — iterate in chronological order (reversed)
    const chronological = [...expenses].reverse()

    const map: Record<string, Record<string, number>> = {}
    for (const exp of chronological) {
      const effectivePayers = exp.payers?.length ? exp.payers : [{ member_id: exp.paid_by, amount: exp.amount }]
      for (const p of effectivePayers) {
        balances[p.member_id] = (balances[p.member_id] || 0) + Number(p.amount)
      }
      for (const s of exp.splits) {
        balances[s.member_id] = (balances[s.member_id] || 0) + Number(s.amount)
      }

      // Snapshot payer balances after this expense
      const payerIds = effectivePayers.map(p => p.member_id)
      map[exp.id] = {}
      for (const id of payerIds) {
        map[exp.id][id] = Math.round((balances[id] || 0) * 100) / 100
      }
    }

    return { payerBalances: map, memberBalances: { ...balances } }
  }, [expenses, members])

  // Members who have explicitly left — excluded by default from new expenses
  const settledMemberIds = useMemo(
    () => new Set(members.filter(m => m.is_left).map(m => m.id)),
    [members]
  )

  if (loading || !adminLoaded) {
    return <div className="phone-frame flex items-center justify-center min-h-dvh text-ink-muted">Loading...</div>
  }

  if (!session) return null

  return (
    <div className="phone-frame pb-20">
      <header className="sticky top-0 bg-white/80 backdrop-blur-sm border-b border-border z-10 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/" className="font-bold text-lg hover:text-accent transition-colors">
              {session.groupName}
            </Link>
            <p className="text-xs text-ink-muted">
              {session.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(memberBalances[session.memberId] ?? 0) > 0.01 && (
              <button
                onClick={openSettleModal}
                className="w-10 h-10 border border-border rounded-full flex items-center justify-center text-ink-soft hover:bg-surface"
                title="Settle up"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M2 12h20M17 7l-5-5-5 5M7 17l5 5 5-5"/>
                </svg>
              </button>
            )}
            <button
              onClick={() => setShowQRModal(true)}
              className="w-10 h-10 border border-border rounded-full flex items-center justify-center text-ink-soft hover:bg-surface"
              title="QR join"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="4" y="4" width="2" height="2" fill="currentColor"/>
                <rect x="12" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="14" y="4" width="2" height="2" fill="currentColor"/>
                <rect x="2" y="12" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="4" y="14" width="2" height="2" fill="currentColor"/>
                <path d="M12 12h2v2h-2zM14 14h2v2h-2zM16 12h2v2h-2zM12 16h2v2h-2zM16 16h2v2h-2z" fill="currentColor"/>
              </svg>
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="w-10 h-10 bg-accent text-white rounded-full flex items-center justify-center text-xl font-bold shadow-lg"
            >
              +
            </button>
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
          <p className="text-center text-ink-muted py-12">Loading expenses...</p>
        ) : (
          <ExpenseList
            expenses={expenses}
            members={members}
            currency={session.currency}
            isAdmin={session.isAdmin && adminMode}
            onEdit={session.isAdmin && adminMode ? startEditExpense : undefined}
            onDelete={handleDelete}
            payerBalances={payerBalances}
          />
        )}
      </main>

      {showQRModal && (
        <QRModal
          groupId={session.groupId}
          memberId={session.memberId}
          onClose={() => setShowQRModal(false)}
        />
      )}

      {showModal && (
        <AddExpenseModal
          members={members}
          currentMemberId={session.memberId}
          isAdmin={session.isAdmin && adminMode}
          currency={session.currency}
          memberBalances={memberBalances}
          settledMemberIds={settledMemberIds}
          editExpense={editingExpense ? {
            description: editingExpense.description,
            amount: Number(editingExpense.amount),
            rating: editingExpense.rating ?? 0,
            payers: (editingExpense.payers ?? []).map(p => ({ memberId: p.member_id, amount: Number(p.amount) })),
            splits: editingExpense.splits.map(s => ({ memberId: s.member_id, amount: Number(s.amount) })),
          } : undefined}
          onSubmit={editingExpense ? handleEditExpense : handleAddExpense}
          onClose={() => { setShowModal(false); setEditingExpense(null) }}
        />
      )}

      {showSettleModal && (
        <SettleModal
          transfers={settleTransfers}
          members={members}
          currency={session.currency}
          onConfirm={handleConfirmSettlement}
          onClose={() => setShowSettleModal(false)}
        />
      )}

      <BottomNav active="expenses" isAdmin={session.isAdmin} groupId={session.groupId} />
    </div>
  )
}
