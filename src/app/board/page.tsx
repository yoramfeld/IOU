'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import { useAdminMode } from '@/hooks/useAdminMode'
import BottomNav from '@/components/ui/BottomNav'
import AdminModeToggle from '@/components/ui/AdminModeToggle'
import BalanceBoard from '@/components/board/BalanceBoard'
import type { MemberBalance, Expense, ExpenseSplit, ExpensePayer } from '@/types'

export default function BoardPage() {
  const router = useRouter()
  const { session, loading, logout } = useSession()
  const { adminMode, setAdminMode, loaded: adminLoaded } = useAdminMode()
  const [balances, setBalances] = useState<MemberBalance[]>([])
  const [expenses, setExpenses] = useState<(Expense & { splits: ExpenseSplit[]; payers: ExpensePayer[] })[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [repairing, setRepairing] = useState(false)
  const [repairResult, setRepairResult] = useState<string | null>(null)
  const [exportState, setExportState] = useState<'idle' | 'loading' | 'done'>('idle')

  const fetchBalances = useCallback(async () => {
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

        // Recompute totals from the fresh expense data so balance always matches the transaction list,
        // even if the balances API returns a slightly stale snapshot (non-atomic inserts).
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

        setBalances(recomputed)
        setExpenses(apiExpenses)
      } else {
        if (balRes.ok) setBalances(await balRes.json())
        if (expRes.ok) setExpenses(await expRes.json())
      }
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

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchBalances() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fetchBalances])

  async function handleRepair() {
    if (!session) return
    setRepairing(true)
    setRepairResult(null)
    try {
      const res = await fetch('/api/repair-balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: session.groupId, adminId: session.memberId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setRepairResult(data.error || 'Repair failed')
      } else if (data.fixed) {
        setRepairResult(`Fixed: adjusted by ${data.adjustment.toFixed(2)}`)
        await fetchBalances()
      } else {
        setRepairResult('Balances are clean')
      }
    } catch {
      setRepairResult('Repair failed')
    } finally {
      setRepairing(false)
    }
  }

  async function handleExport() {
    if (!session || balances.length === 0) return
    setExportState('loading')
    await new Promise(r => setTimeout(r, 0)) // yield so React paints the spinner
    const XLSX = await import('xlsx')

    const nameById: Record<string, string> = {}
    for (const b of balances) nameById[b.id] = b.name

    const sorted = [...balances].sort((a, b) => {
      const diff = Number(a.balance) - Number(b.balance)
      return diff !== 0 ? diff : a.name.localeCompare(b.name)
    })

    const rows: (string | number)[][] = []
    const chrono = [...expenses].reverse()

    const fmtDate = (iso: string) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}` }
    const earliest = chrono.length ? fmtDate(chrono[0].created_at) : ''
    const latest   = chrono.length ? fmtDate(chrono[chrono.length - 1].created_at) : ''
    const dateSpan = chrono.length ? (earliest === latest ? earliest : `${earliest} – ${latest}`) : ''
    rows.push([`IOU – ${session.groupName}  |  ${dateSpan}  |  Currency: ${session.currency}`, '', '', '', ''])
    rows.push(['', '', '', '', ''])

    for (const b of sorted) {
      const bal = Number(b.balance)
      rows.push([
        b.name,
        `Balance: ${bal >= 0 ? '+' : ''}${bal.toFixed(2)}  Paid: ${Number(b.total_paid).toFixed(2)}`,
        '',
        '',
        '',
      ])

      for (const exp of chrono) {
        const effectivePayers = exp.payers?.length
          ? exp.payers
          : [{ member_id: exp.paid_by, amount: exp.amount }]
        const payer = effectivePayers.find(p => p.member_id === b.id)
        if (payer) {
          const dt = new Date(exp.created_at)
          const participants = exp.splits.map(s => nameById[s.member_id] ?? s.member_id).join(', ')
          const ratingStr = exp.rating ? '★'.repeat(exp.rating) : ''
          rows.push([`${dt.getDate()}/${dt.getMonth() + 1}`, exp.description, Number(payer.amount), participants, ratingStr])
        }
        const split = exp.splits.find(s => s.member_id === b.id)
        if (split) {
          const dt = new Date(exp.created_at)
          rows.push([`${dt.getDate()}/${dt.getMonth() + 1}`, exp.description, -Math.abs(Number(split.amount)), '', ''])
        }
      }
      rows.push(['', '', '', '', ''])
    }

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 10 }, { wch: 30 }, { wch: 10 }, { wch: 30 }, { wch: 8 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Balances')
    const now = new Date()
    const d = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const t = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
    XLSX.writeFile(wb, `iou-${session.groupName}-${d}-${t}.xlsx`)
    setExportState('done')
    setTimeout(() => setExportState('idle'), 2000)
  }

  async function handleRenameMember(memberId: string, newName: string) {
    if (!session) return
    await fetch('/api/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, adminId: session.memberId, name: newName }),
    })
    await fetchBalances()
  }

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
              {session.name} · <Link href="/" className="hover:text-accent transition-colors">{session.groupName}</Link>
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={exportState !== 'idle'}
            title="Download as Excel"
            className="p-1.5 rounded-lg text-ink-muted hover:text-accent hover:bg-surface transition-colors disabled:cursor-default"
          >
            {exportState === 'loading' && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#217346" strokeWidth="2.5" strokeLinecap="round" className="animate-spin">
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
            )}
            {exportState === 'done' && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#217346" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
            {exportState === 'idle' && (
              <svg width="20" height="20" viewBox="0 0 24 24">
                <rect x="1" y="1" width="22" height="22" rx="3" fill="#217346"/>
                <path d="M7 7l5 5 5-5M7 17l5-5 5 5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
            )}
          </button>
        </div>
        {session.isAdmin && (
          <div className="mt-2 flex items-center gap-2">
            <AdminModeToggle adminMode={adminMode} setAdminMode={setAdminMode} />
            {adminMode && (
              <button
                onClick={handleRepair}
                disabled={repairing}
                className="ml-auto text-xs px-3 py-1 border border-border rounded-full text-ink-soft hover:bg-surface disabled:opacity-50"
              >
                {repairing ? 'Repairing...' : 'Repair balances'}
              </button>
            )}
          </div>
        )}
        {repairResult && (
          <p className="mt-1 text-xs text-ink-muted">{repairResult}</p>
        )}
      </header>

      <main className="p-4">
        {loadingData ? (
          <p className="text-center text-ink-muted py-12">Loading balances...</p>
        ) : (
          <BalanceBoard
            balances={balances}
            expenses={expenses}
            currency={session.currency}
            currentMemberId={session.memberId}
            isAdmin={session.isAdmin && adminMode}
            onRenameMember={session.isAdmin && adminMode ? handleRenameMember : undefined}
            onRemoveMember={handleRemoveMember}
          />
        )}
      </main>

      <BottomNav active="board" isAdmin={session.isAdmin} groupId={session.groupId} />
    </div>
  )
}
