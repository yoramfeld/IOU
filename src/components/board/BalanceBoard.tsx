'use client'

import type { MemberBalance } from '@/types'
import MemberAvatar from '@/components/ui/MemberAvatar'
import clsx from 'clsx'

interface Props {
  balances: MemberBalance[]
  currency: string
  currentMemberId: string
  isAdmin?: boolean
  onRenameMember?: (id: string, newName: string) => void
  onRemoveMember?: (id: string) => void
}

export default function BalanceBoard({ balances, currency, currentMemberId, isAdmin, onRenameMember, onRemoveMember }: Props) {
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

  return (
    <div className="space-y-2">
      {sorted.map(b => {
        const bal = Number(b.balance)
        const isPositive = bal > 0.01
        const isNegative = bal < -0.01
        const isMe = b.id === currentMemberId
        const isTopDebtor = minBalKey !== null && bal.toFixed(2) === minBalKey

        return (
          <div key={b.id} className={clsx(
            'card flex items-center gap-3',
            isMe && 'ring-2 ring-accent/20',
            isPositive && 'bg-green/5',
            isTopDebtor && 'bg-red/5 ring-1 ring-red/20',
          )}>
            <MemberAvatar name={b.name} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">
                {b.name}
                {isMe && <span className="text-xs text-ink-muted ml-1">(you)</span>}
                {b.is_admin && <span className="text-xs text-amber-600 ml-1">admin</span>}
                {isAdmin && onRenameMember && (
                  <button
                    onClick={() => {
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
      <div className="text-center text-xs text-ink-muted pt-2">
        Total: {currency}{total.toFixed(2)}
      </div>
    </div>
  )
}
