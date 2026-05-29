'use client'

import { useState } from 'react'
import type { Expense, ExpensePayer, ExpenseSplit, Member } from '@/types'
import MemberAvatar from '@/components/ui/MemberAvatar'

interface Props {
  expense: Expense & { splits: ExpenseSplit[]; payers?: ExpensePayer[] }
  members: Member[]
  currency: string
  isAdmin?: boolean
  onEdit?: (expense: Expense & { splits: ExpenseSplit[]; payers?: ExpensePayer[] }) => void
  onDelete?: (id: string) => void
  payerBalances?: Record<string, number>
}

export default function ExpenseCard({ expense, members, currency, isAdmin, onEdit, onDelete, payerBalances }: Props) {
  const [showReceipt, setShowReceipt] = useState(false)
  const payer = members.find(m => m.id === expense.paid_by)
  const enteredBy = members.find(m => m.id === expense.entered_by)
  const isMultiPayer = (expense.payers?.length ?? 0) > 1
  const splitPairs = expense.splits
    .map(s => ({ member: members.find(m => m.id === s.member_id), amount: s.amount }))
    .filter(p => p.member != null) as { member: Member; amount: number | string }[]

  const isUnequal = splitPairs.length > 1 &&
    splitPairs.some(p => Number(p.amount) !== Number(splitPairs[0].amount))

  // Group members by their rounded amount for display
  const groupedSplits: { amount: number; names: string[] }[] = isUnequal
    ? Object.entries(
        splitPairs.reduce((acc, { member, amount }) => {
          const key = Math.round(Number(amount) * 100) / 100
          if (!acc[key]) acc[key] = []
          acc[key].push(member.name)
          return acc
        }, {} as Record<number, string[]>)
      )
        .map(([amount, names]) => ({ amount: Number(amount), names }))
        .sort((a, b) => b.amount - a.amount)
    : []

  const onBehalf = expense.entered_by !== expense.paid_by
  const isSettlement = expense.description.startsWith('⚡ Settlement:')
  const dt = new Date(expense.created_at)
  const dateStr = `${dt.getDate()}/${dt.getMonth() + 1} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {payer && <MemberAvatar name={payer.name} />}
          <div className="min-w-0 flex-1">
            {isSettlement ? (
              <>
                <p className="font-semibold text-sm">Settlement</p>
                {(expense.payers ?? [{ member_id: expense.paid_by, amount: expense.amount }]).map(p => {
                  const m = members.find(x => x.id === p.member_id)
                  const bal = payerBalances?.[p.member_id]
                  return (
                    <p key={p.member_id} className="text-xs text-ink-muted whitespace-nowrap overflow-hidden">
                      <span>{m?.name} paid {splitPairs[0]?.member.name} and now at </span>
                      {bal !== undefined && (
                        <span className={`font-medium ${bal >= 0 ? 'text-green' : 'text-red'}`}>
                          {`${bal >= 0 ? '+' : '-'}${currency}${Math.abs(Math.round(bal))}`}
                        </span>
                      )}
                    </p>
                  )
                })}
              </>
            ) : (
              <>
                <p className="font-semibold text-sm truncate">{expense.description}</p>
                {(expense.payers ?? [{ member_id: expense.paid_by, amount: expense.amount }]).map(p => {
                  const m = members.find(x => x.id === p.member_id)
                  const bal = payerBalances?.[p.member_id]
                  return (
                    <p key={p.member_id} className="text-xs text-ink-muted whitespace-nowrap overflow-hidden">
                      {isMultiPayer ? (
                        <span>{m?.name} paid {currency}{Math.round(Number(p.amount))}</span>
                      ) : (
                        <>
                          <span>{m?.name} paid and now at </span>
                          {bal !== undefined && (
                            <span className={`font-medium ${bal >= 0 ? 'text-green' : 'text-red'}`}>
                              {`${bal >= 0 ? '+' : '-'}${currency}${Math.abs(Math.round(bal))}`}
                            </span>
                          )}
                        </>
                      )}
                    </p>
                  )
                })}
                {onBehalf && enteredBy && (
                  <p className="text-xs text-ink-muted italic">(entered by {enteredBy.name})</p>
                )}
              </>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-sm">{currency}{Math.round(Number(expense.amount))}</p>
          {isAdmin && (onEdit || onDelete) && (
            <div className="flex gap-2 mt-1">
              {onEdit && (
                <button
                  onClick={() => onEdit(expense)}
                  className="text-xs text-accent hover:underline"
                >
                  Edit
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => onDelete(expense.id)}
                  className="text-xs text-red hover:underline"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-end justify-between mt-2 gap-2">
        <div className="flex items-center gap-2">
          <p className="text-xs text-ink-muted whitespace-nowrap overflow-hidden">{dateStr}</p>
          {expense.receipt_url && (
            <button
              onClick={() => setShowReceipt(true)}
              className="text-ink-muted hover:text-accent transition-colors"
              title="View receipt"
            >
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="5" width="18" height="13" rx="2"/>
                <circle cx="10" cy="11.5" r="3.5"/>
                <path d="M7 5V4a1 1 0 011-1h4a1 1 0 011 1v1"/>
              </svg>
            </button>
          )}
        </div>
        {!isSettlement && (
          <div className="flex gap-1 flex-wrap justify-end">
            {isUnequal ? (
              groupedSplits.map(({ amount, names }) => (
                <span key={amount} className="text-xs bg-surface text-ink-muted px-2 py-0.5 rounded-full">
                  {names.join(', ')}: {currency}{amount % 1 === 0 ? amount : amount.toFixed(2)}
                </span>
              ))
            ) : (
              splitPairs.map(({ member: m }) => (
                <span key={m.id} className="text-xs bg-surface text-ink-muted px-2 py-0.5 rounded-full">
                  {m.name}
                </span>
              ))
            )}
          </div>
        )}
      </div>
      {showReceipt && expense.receipt_url && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowReceipt(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={expense.receipt_url}
            alt="Receipt"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
