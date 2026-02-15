'use client'

import { useState } from 'react'
import type { Transfer } from '@/types'
import MemberAvatar from '@/components/ui/MemberAvatar'

interface Props {
  transfers: Transfer[]
  currency: string
  currentMemberId?: string
  isAdmin?: boolean
  onSettle?: (transfer: Transfer) => Promise<void>
}

export default function SettlementList({ transfers, currency, currentMemberId, isAdmin, onSettle }: Props) {
  const [settlingIndex, setSettlingIndex] = useState<number | null>(null)

  if (transfers.length === 0) {
    return (
      <div className="text-center py-12 text-ink-muted">
        <p className="text-4xl mb-3">✅</p>
        <p className="text-sm font-medium">All settled up!</p>
        <p className="text-xs mt-1">No transfers needed</p>
      </div>
    )
  }

  const handleSettle = async (transfer: Transfer, index: number) => {
    if (!onSettle) return
    if (!confirm(`Make sure you received ${currency}${transfer.amount.toFixed(2)} from ${transfer.fromName} and only then confirm`)) return
    setSettlingIndex(index)
    try {
      await onSettle(transfer)
    } finally {
      setSettlingIndex(null)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted font-medium">
        {transfers.length} transfer{transfers.length !== 1 ? 's' : ''} needed to settle up:
      </p>
      {transfers.map((t, i) => {
        const canSettle = onSettle && currentMemberId === t.to
        return (
          <div key={i} className="card space-y-2">
            <div className="flex items-center gap-3">
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
            {canSettle && (
              <button
                onClick={() => handleSettle(t, i)}
                disabled={settlingIndex !== null}
                className="w-full text-xs font-medium px-3 py-1.5 rounded-full bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {settlingIndex === i ? 'Settling...' : 'Mark settled'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
