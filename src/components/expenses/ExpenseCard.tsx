'use client'

import type { Expense, ExpenseSplit, Member } from '@/types'
import MemberAvatar from '@/components/ui/MemberAvatar'

interface Props {
  expense: Expense & { splits: ExpenseSplit[] }
  members: Member[]
  currency: string
  isAdmin?: boolean
  onDelete?: (id: string) => void
}

export default function ExpenseCard({ expense, members, currency, isAdmin, onDelete }: Props) {
  const payer = members.find(m => m.id === expense.paid_by)
  const enteredBy = members.find(m => m.id === expense.entered_by)
  const splitMembers = expense.splits
    .map(s => members.find(m => m.id === s.member_id))
    .filter(Boolean) as Member[]

  const onBehalf = expense.entered_by !== expense.paid_by

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {payer && <MemberAvatar name={payer.name} />}
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{expense.description}</p>
            <p className="text-xs text-ink-muted">
              {payer?.name} paid
              {onBehalf && enteredBy && (
                <span className="italic"> (entered by {enteredBy.name})</span>
              )}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-sm">{currency}{Number(expense.amount).toFixed(2)}</p>
          {isAdmin && onDelete && (
            <button
              onClick={() => onDelete(expense.id)}
              className="text-xs text-red hover:underline mt-1"
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-1 mt-2 flex-wrap">
        {splitMembers.map(m => (
          <span key={m.id} className="text-xs bg-surface text-ink-muted px-2 py-0.5 rounded-full">
            {m.name}
          </span>
        ))}
      </div>
    </div>
  )
}
