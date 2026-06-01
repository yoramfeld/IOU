'use client'

import { useState, useMemo } from 'react'
import type { MemberBalance, Expense, ExpenseSplit, ExpensePayer } from '@/types'
import MemberAvatar from '@/components/ui/MemberAvatar'
import { calculateSettlements } from '@/lib/settle'
import clsx from 'clsx'

interface Props {
  balances: MemberBalance[]
  expenses?: (Expense & { splits: ExpenseSplit[]; payers: ExpensePayer[] })[]
  currency: string
  currentMemberId: string
  isAdmin?: boolean
  onRenameMember?: (id: string, newName: string) => void
  onRemoveMember?: (id: string) => void
  onLeave?: (id: string) => void
}

export default function BalanceBoard({ balances, expenses, currency, currentMemberId, isAdmin, onRenameMember, onRemoveMember, onLeave }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  if (balances.length === 0) {
    return (
      <div className="text-center py-12 text-ink-muted">
        <p className="text-4xl mb-3">📊</p>
        <p className="text-sm">No members yet</p>
      </div>
    )
  }

  // Sort by balance ascending, then name ascending
  const sorted = [...balances].sort((a, b) => {
    const diff = Number(a.balance) - Number(b.balance)
    return diff !== 0 ? diff : a.name.localeCompare(b.name)
  })

  // Find the lowest (most negative) balance — highlight all members who share it
  const minBal = sorted.length > 0 ? Number(sorted[0].balance) : 0
  const minBalKey = minBal < -0.01 ? minBal.toFixed(2) : null
  const minCount = minBalKey
    ? sorted.filter(b => Number(b.balance).toFixed(2) === minBalKey).length
    : 0

  const total = Math.round(balances.reduce((s, b) => s + Number(b.balance), 0) * 100) / 100
  const totalPaid = Math.round(balances.reduce((s, b) => s + Number(b.total_paid), 0) * 100) / 100

  // Members with pending settlement actions (used to gate the Leave button)
  const pendingTransfers = calculateSettlements(balances)
  const activeIds = new Set(pendingTransfers.flatMap(t => [t.from, t.to]))

  return (
    <div className="space-y-2">
      {sorted.map(b => {
        const bal = Number(b.balance)
        const isPositive = bal > 0.01
        const isNegative = bal < -0.01
        const isMe = b.id === currentMemberId
        const canLeave = onLeave && !b.is_left && !activeIds.has(b.id) && (isMe || isAdmin)
        const isTopDebtor = minBalKey !== null && bal.toFixed(2) === minBalKey

        const isExpanded = expandedId === b.id

        // Build transaction list for this member when expanded
        const transactions = isExpanded && expenses ? (() => {
          const txns: { date: string; description: string; amount: number; type: 'paid' | 'owed' }[] = []
          // Iterate chronologically (expenses are DESC, so reverse)
          const chrono = [...expenses].reverse()
          for (const exp of chrono) {
            const effectivePayers = exp.payers?.length ? exp.payers : [{ member_id: exp.paid_by, amount: exp.amount }]
            const payer = effectivePayers.find(p => p.member_id === b.id)
            if (payer) {
              txns.push({
                date: exp.created_at,
                description: exp.description,
                amount: Number(payer.amount),
                type: 'paid',
              })
            }
            const split = exp.splits.find(s => s.member_id === b.id)
            if (split) {
              txns.push({
                date: exp.created_at,
                description: exp.description,
                amount: Math.abs(Number(split.amount)),
                type: 'owed',
              })
            }
          }
          return txns
        })() : []

        return (
          <div key={b.id} className={clsx(
            'card',
            b.is_left && 'opacity-40',
            isMe && 'ring-2 ring-accent/20',
            isPositive && 'bg-green/5',
            isTopDebtor && 'bg-red/5 ring-1 ring-red/20',
          )}>
            <div
              className="flex items-center gap-3 cursor-pointer"
              onClick={() => setExpandedId(isExpanded ? null : b.id)}
            >
              <MemberAvatar name={b.name} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">
                  {b.name}
                  {isMe && <span className="text-xs text-ink-muted ml-1">(you)</span>}
                  {b.is_admin && <span className="text-xs text-amber-600 ml-1">admin</span>}
                  {isAdmin && onRenameMember && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const newName = prompt('New name:', b.name)
                        if (newName && newName.trim() && newName.trim() !== b.name) {
                          onRenameMember(b.id, newName.trim())
                        }
                      }}
                      className="ml-1 text-ink-muted hover:text-accent inline-block align-middle"
                      title="Rename member"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                        <path d="m15 5 4 4"/>
                      </svg>
                    </button>
                  )}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={clsx(
                  'font-bold text-sm',
                  isPositive && 'text-green',
                  isNegative && 'text-red',
                  !isPositive && !isNegative && 'text-ink-muted'
                )}>
                  {isPositive ? '+' : ''}{currency}{bal.toFixed(2)}
                </p>
                {b.total_paid > 0 && (
                  <p className="text-xs text-ink-muted">
                    paid {currency}{Number(b.total_paid).toFixed(2)}
                  </p>
                )}
                {canLeave && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onLeave(b.id) }}
                    className="text-xs text-ink-muted hover:text-red hover:underline mt-1 block"
                  >
                    Leave
                  </button>
                )}
                {isAdmin && onRemoveMember && b.id !== currentMemberId && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveMember(b.id) }}
                    className="text-xs text-red hover:underline mt-1"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            {isExpanded && transactions.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border space-y-1">
                {transactions.map((txn, i) => {
                  const dt = new Date(txn.date)
                  const dateStr = `${dt.getDate()}/${dt.getMonth() + 1}`
                  return (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-ink-muted w-10 shrink-0">{dateStr}</span>
                        <span className="truncate">{txn.description}</span>
                      </div>
                      <span className={clsx(
                        'shrink-0 ml-2 font-medium',
                        txn.type === 'paid' ? 'text-green' : 'text-red'
                      )}>
                        {txn.type === 'paid' ? '+' : '-'}{currency}{txn.amount.toFixed(2)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
            {isExpanded && transactions.length === 0 && (
              <p className="mt-2 pt-2 border-t border-border text-xs text-ink-muted">No transactions</p>
            )}
          </div>
        )
      })}
      <div className="text-center text-xs text-ink-muted pt-2 space-y-0.5">
        <div>Total: {currency}{total.toFixed(2)}</div>
        <div>Total paid: {currency}{totalPaid.toFixed(2)}</div>
      </div>
    </div>
  )
}
