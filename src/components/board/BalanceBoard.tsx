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

  return (
    <div className="space-y-2">
      {balances.map(b => {
        const isPositive = b.balance > 0.01
        const isNegative = b.balance < -0.01
        const isMe = b.id === currentMemberId

        return (
          <div key={b.id} className={clsx('card flex items-center gap-3', isMe && 'ring-2 ring-accent/20')}>
            <MemberAvatar name={b.name} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">
                {b.name}
                {isMe && <span className="text-xs text-ink-muted ml-1">(you)</span>}
                {b.is_admin && <span className="text-xs text-amber-600 ml-1">admin</span>}
              </p>
              <p className="text-xs text-ink-muted">
                Paid {currency}{Number(b.total_paid).toFixed(2)} · {b.balance > 0.01 ? 'Owed' : 'Owes'} {currency}{Math.abs(Number(b.total_owed)).toFixed(2)}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className={clsx(
                'font-bold text-sm',
                isPositive && 'text-green',
                isNegative && 'text-red',
                !isPositive && !isNegative && 'text-ink-muted'
              )}>
                {isPositive ? '+' : ''}{currency}{Number(b.balance).toFixed(2)}
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
