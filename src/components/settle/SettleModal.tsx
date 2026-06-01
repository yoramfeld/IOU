'use client'

import { useState } from 'react'
import type { Member } from '@/types'

interface Props {
  members: Member[]
  currency: string
  onConfirm: (fromId: string, amount: number) => Promise<void>
  onClose: () => void
}

export default function SettleModal({ members, currency, onConfirm, onClose }: Props) {
  const [fromId, setFromId] = useState(members[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const parsed = parseFloat(amount)
  const canSubmit = fromId && parsed > 0 && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      await onConfirm(fromId, parsed)
      onClose()
    } catch {
      setError('Failed to record. Try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center">
      <div className="bg-white rounded-t-2xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Record incoming payment</h2>
          <button onClick={onClose} className="text-ink-muted text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-ink-soft block mb-1">Received from</label>
            <select
              className="input"
              value={fromId}
              onChange={e => setFromId(e.target.value)}
            >
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-ink-soft block mb-1">Amount ({currency})</label>
            <input
              className="input"
              type="number"
              step="any"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onFocus={e => e.target.select()}
              autoFocus
            />
          </div>

          {error && <p className="text-xs text-red">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn btn-primary w-full disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Record payment'}
          </button>
        </div>
      </div>
    </div>
  )
}
