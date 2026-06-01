'use client'

import { useState } from 'react'
import type { Transfer, Member } from '@/types'
import MemberAvatar from '@/components/ui/MemberAvatar'

interface Props {
  transfers: Transfer[]
  members: Member[]
  currency: string
  onConfirm: (transfer: Transfer) => Promise<void>
  onClose: () => void
}

export default function SettleModal({ transfers, members, currency, onConfirm, onClose }: Props) {
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<Record<string, string>>({})

  async function handleConfirm(t: Transfer) {
    setSubmitting(prev => ({ ...prev, [t.from]: true }))
    setError(prev => ({ ...prev, [t.from]: '' }))
    try {
      await onConfirm(t)
    } catch {
      setError(prev => ({ ...prev, [t.from]: 'Failed, try again' }))
      setSubmitting(prev => ({ ...prev, [t.from]: false }))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center">
      <div className="bg-white rounded-t-2xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Settle up</h2>
          <button onClick={onClose} className="text-ink-muted text-xl leading-none">&times;</button>
        </div>

        {transfers.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <p className="text-3xl">✓</p>
            <p className="font-semibold text-ink">You&apos;re all settled up</p>
            <p className="text-sm text-ink-muted">No one owes you anything right now.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">Confirm when you&apos;ve received a payment:</p>
            {transfers.map(t => (
              <div key={t.from} className="flex items-center gap-3">
                <MemberAvatar name={t.fromName} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{t.fromName}</p>
                  <p className="text-xs text-ink-muted">owes you {currency}{t.amount.toFixed(2)}</p>
                  {error[t.from] && <p className="text-xs text-red">{error[t.from]}</p>}
                </div>
                <button
                  onClick={() => handleConfirm(t)}
                  disabled={submitting[t.from]}
                  className="btn btn-outline text-xs py-1.5 px-3 shrink-0 disabled:opacity-50"
                >
                  {submitting[t.from] ? 'Saving…' : 'Received'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
