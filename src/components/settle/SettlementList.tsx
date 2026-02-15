'use client'

import type { Transfer } from '@/types'
import MemberAvatar from '@/components/ui/MemberAvatar'

interface Props {
  transfers: Transfer[]
  currency: string
}

export default function SettlementList({ transfers, currency }: Props) {
  if (transfers.length === 0) {
    return (
      <div className="text-center py-12 text-ink-muted">
        <p className="text-4xl mb-3">✅</p>
        <p className="text-sm font-medium">All settled up!</p>
        <p className="text-xs mt-1">No transfers needed</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted font-medium">
        {transfers.length} transfer{transfers.length !== 1 ? 's' : ''} needed to settle up:
      </p>
      {transfers.map((t, i) => (
        <div key={i} className="card flex items-center gap-3">
          <MemberAvatar name={t.fromName} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm">
              <span className="font-semibold">{t.fromName}</span>
              <span className="text-ink-muted mx-1">→</span>
              <span className="font-semibold">{t.toName}</span>
            </p>
          </div>
          <p className="font-bold text-sm text-accent shrink-0">
            {currency}{t.amount.toFixed(2)}
          </p>
        </div>
      ))}
    </div>
  )
}
