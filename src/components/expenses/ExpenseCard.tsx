'use client'

import { useState } from 'react'
import type { Expense, ExpensePayer, ExpenseSplit, Member } from '@/types'
import MemberAvatar from '@/components/ui/MemberAvatar'

const EDIT_WINDOW_MS = 2 * 60 * 60 * 1000  // 2 hours

interface Props {
  expense: Expense & { splits: ExpenseSplit[]; payers?: ExpensePayer[] }
  members: Member[]
  currency: string
  isAdmin?: boolean
  currentMemberId?: string
  onEdit?: (expense: Expense & { splits: ExpenseSplit[]; payers?: ExpensePayer[] }) => void
  onDelete?: (id: string) => void
  payerBalances?: Record<string, number>
}

export default function ExpenseCard({ expense, members, currency, isAdmin, currentMemberId, onEdit, onDelete, payerBalances }: Props) {
  const [showReceipt, setShowReceipt] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const isEnteredByMe = currentMemberId === expense.entered_by
  const withinEditWindow = Date.now() - new Date(expense.created_at).getTime() < EDIT_WINDOW_MS
  const canEdit = !!onEdit && (isAdmin || (isEnteredByMe && withinEditWindow))
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
    <div className="card cursor-pointer" onClick={() => setShowDetails(true)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {payer && <MemberAvatar name={payer.name} />}
          <div className="min-w-0 flex-1">
            {isSettlement ? (
              <>
                <p className="font-semibold text-sm">Transfer</p>
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
          {(canEdit || (isAdmin && onDelete)) && (
            <div className="flex gap-2 mt-1">
              {canEdit && (
                <button
                  onClick={e => { e.stopPropagation(); onEdit!(expense) }}
                  className="text-xs text-accent hover:underline"
                >
                  Edit
                </button>
              )}
              {isAdmin && onDelete && (
                <button
                  onClick={e => { e.stopPropagation(); onDelete(expense.id) }}
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
          {expense.expense_type && (
            <span className="text-xs bg-surface text-ink-muted px-2 py-0.5 rounded-full shrink-0">{expense.expense_type}</span>
          )}
          {expense.lat != null && expense.lng != null && (
            <a
              href={`https://maps.google.com/?q=${expense.lat},${expense.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-ink-muted hover:text-accent transition-colors"
              title="View on map"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                <circle cx="12" cy="9" r="2.5"/>
              </svg>
            </a>
          )}
          {expense.rating != null && expense.rating > 0 && (
            <div className="flex items-center gap-0.5">
              {[1,2,3,4,5].map(star => (
                <svg key={star} width="11" height="11" viewBox="0 0 24 24"
                  fill={star <= expense.rating! ? '#f59e0b' : 'none'}
                  stroke={star <= expense.rating! ? '#f59e0b' : '#d1d5db'}
                  strokeWidth="1.5">
                  <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
                </svg>
              ))}
            </div>
          )}
          {expense.receipt_url && (
            <button
              onClick={e => { e.stopPropagation(); setShowReceipt(true) }}
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
      {showDetails && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center"
          onClick={() => setShowDetails(false)}
        >
          <div
            className="bg-white rounded-t-2xl w-full max-w-sm p-5 space-y-4 max-h-[80dvh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{isSettlement ? 'Transfer' : expense.description}</h2>
                <p className="text-xs text-ink-muted">
                  {dt.getDate()}/{dt.getMonth()+1}/{dt.getFullYear()} {String(dt.getHours()).padStart(2,'0')}:{String(dt.getMinutes()).padStart(2,'0')}
                </p>
              </div>
              <button onClick={() => setShowDetails(false)} className="text-ink-muted text-xl leading-none shrink-0">&times;</button>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold">{currency}{Number(expense.amount).toFixed(2)}</span>
              {expense.expense_type && (
                <span className="text-xs bg-surface text-ink-muted px-2 py-0.5 rounded-full">{expense.expense_type}</span>
              )}
              {expense.rating != null && expense.rating > 0 && (
                <div className="flex gap-0.5">
                  {[1,2,3,4,5].map(s => (
                    <svg key={s} width="14" height="14" viewBox="0 0 24 24"
                      fill={s <= expense.rating! ? '#f59e0b' : 'none'}
                      stroke={s <= expense.rating! ? '#f59e0b' : '#d1d5db'} strokeWidth="1.5">
                      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
                    </svg>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Paid by</p>
              {(expense.payers ?? [{ member_id: expense.paid_by, amount: expense.amount }]).map(p => {
                const m = members.find(x => x.id === p.member_id)
                return (
                  <div key={p.member_id} className="flex items-center gap-2">
                    {m && <MemberAvatar name={m.name} />}
                    <span className="text-sm flex-1">{m?.name ?? '?'}</span>
                    <span className="text-sm font-semibold text-green">{currency}{Number(p.amount).toFixed(2)}</span>
                  </div>
                )
              })}
            </div>

            {!isSettlement && splitPairs.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Split among</p>
                {splitPairs.map(({ member: m, amount }) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <MemberAvatar name={m.name} />
                    <span className="text-sm flex-1">{m.name}</span>
                    <span className="text-sm font-semibold text-red">{currency}{Math.abs(Number(amount)).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}

            {onBehalf && enteredBy && (
              <p className="text-xs text-ink-muted">Entered by {enteredBy.name}</p>
            )}

            {expense.lat != null && expense.lng != null && (
              <a
                href={`https://maps.google.com/?q=${expense.lat},${expense.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-accent"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                  <circle cx="12" cy="9" r="2.5"/>
                </svg>
                View on map
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
