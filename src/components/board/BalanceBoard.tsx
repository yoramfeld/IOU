'use client'

import type { MemberBalance } from '@/types'
import MemberAvatar from '@/components/ui/MemberAvatar'
import clsx from 'clsx'

interface Props {
  balances: MemberBalance[]
  currency: string
  currentMemberId: string
  isAdmin?: boolean
  onRemoveMember?: (id: string) => void
}

export default function BalanceBoard({ balances, currency, currentMemberId, isAdmin, onRemoveMember }: Props) {
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

  // Find negative balances that are shared by multiple users
  const negCounts: Record<string, number> = {}
  for (const b of sorted) {
    const bal = Number(b.balance)
    if (bal < -0.01) {
      const key = bal.toFixed(2)
      negCounts[key] = (negCounts[key] || 0) + 1
    }
  }

  return (
    <div className="space-y-2">
      {sorted.map(b => {
        const bal = Number(b.balance)
        const isPositive = bal > 0.01
        const isNegative = bal < -0.01
        const isMe = b.id === currentMemberId
        const isSharedDebt = isNegative && (negCounts[bal.toFixed(2)] ?? 0) > 1

        return (
          <div key={b.id} className={clsx(
            'card flex items-center gap-3',
            isMe && 'ring-2 ring-accent/20',
            isPositive && 'bg-green/5',
            isSharedDebt && 'bg-red/5 ring-1 ring-red/20',
          )}>
            <MemberAvatar name={b.name} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">
                {b.name}
                {isMe && <span className="text-xs text-ink-muted ml-1">(you)</span>}
                {b.is_admin && <span className="text-xs text-amber-600 ml-1">admin</span>}
              </p>
              <p className="text-xs text-ink-muted">
                Paid {currency}{Number(b.total_paid).toFixed(2)}
              </p>
              <p className={clsx(
                'text-xs font-medium',
                isPositive && 'text-green',
                isNegative && 'text-red',
                !isPositive && !isNegative && 'text-ink-muted'
              )}>
                {isPositive ? '+' : '-'}{currency}{Math.abs(Number(b.total_owed)).toFixed(2)}
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
              {isAdmin && onRemoveMember && b.id !== currentMemberId && (
                <button
                  onClick={() => onRemoveMember(b.id)}
                  className="text-xs text-red hover:underline mt-1"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
