'use client'

import { useState } from 'react'
import type { Member } from '@/types'

interface Props {
  members: Member[]
  currentMemberId: string
  isAdmin: boolean
  currency: string
  onSubmit: (data: {
    paidBy: string
    amount: number
    description: string
    splitAmong: string[]
  }) => Promise<void>
  onClose: () => void
}

export default function AddExpenseModal({ members, currentMemberId, isAdmin, currency, onSubmit, onClose }: Props) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState(currentMemberId)
  const [splitAmong, setSplitAmong] = useState<string[]>(members.map(m => m.id))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function toggleMember(id: string) {
    setSplitAmong(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  async function handleSubmit() {
    const numAmount = parseFloat(amount)
    if (!description.trim() || isNaN(numAmount) || numAmount <= 0 || splitAmong.length === 0) {
      setError('Fill in all fields and select at least one person')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onSubmit({
        paidBy,
        amount: numAmount,
        description: description.trim(),
        splitAmong,
      })
      onClose()
    } catch {
      setError('Failed to add expense')
    }
    setSubmitting(false)
  }

  const perPerson = splitAmong.length > 0 && amount
    ? (parseFloat(amount) / splitAmong.length).toFixed(2)
    : '0.00'

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center">
      <div className="bg-white rounded-t-2xl w-full max-w-sm max-h-[90dvh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Add expense</h2>
          <button onClick={onClose} className="text-ink-muted text-xl leading-none">&times;</button>
        </div>

        <input
          className="input"
          placeholder="What was it for?"
          value={description}
          onChange={e => setDescription(e.target.value)}
          autoFocus
        />

        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted text-sm">{currency}</span>
          <input
            className="input pl-8"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-ink-soft block mb-2">Who paid?</label>
          <select
            className="input"
            value={paidBy}
            onChange={e => setPaidBy(e.target.value)}
          >
            {members.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}{m.id === currentMemberId ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-ink-soft block mb-2">
            Split among ({splitAmong.length} people — {currency}{perPerson} each)
          </label>
          <div className="space-y-1">
            {members.map(m => (
              <label key={m.id} className="flex items-center gap-2 py-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={splitAmong.includes(m.id)}
                  onChange={() => toggleMember(m.id)}
                  className="w-4 h-4"
                />
                <span className="text-sm">{m.name}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-red text-sm">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="btn btn-primary"
        >
          {submitting ? 'Adding...' : 'Add expense'}
        </button>
      </div>
    </div>
  )
}
