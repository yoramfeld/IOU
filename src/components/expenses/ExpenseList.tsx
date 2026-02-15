'use client'

import type { Expense, ExpenseSplit, Member } from '@/types'
import ExpenseCard from './ExpenseCard'

interface Props {
  expenses: (Expense & { splits: ExpenseSplit[] })[]
  members: Member[]
  currency: string
  isAdmin?: boolean
  onDelete?: (id: string) => void
}

export default function ExpenseList({ expenses, members, currency, isAdmin, onDelete }: Props) {
  if (expenses.length === 0) {
    return (
      <div className="text-center py-12 text-ink-muted">
        <p className="text-4xl mb-3">💸</p>
        <p className="text-sm">No expenses yet</p>
        <p className="text-xs mt-1">Tap + to add the first one</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {expenses.map(expense => (
        <ExpenseCard
          key={expense.id}
          expense={expense}
          members={members}
          currency={currency}
          isAdmin={isAdmin}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
