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
    customSplits?: { memberId: string; amount: number }[]
    payers: { memberId: string; amount: number }[]
  }) => Promise<void>
  onClose: () => void
}

const TIP_OPTIONS = [0, 10, 12, 15]

export default function AddExpenseModal({ members, currentMemberId, isAdmin, currency, onSubmit, onClose }: Props) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState(currentMemberId)
  const [splitAmong, setSplitAmong] = useState<string[]>(members.map(m => m.id))
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal')
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const [tipPct, setTipPct] = useState(0)
  const [roundUp, setRoundUp] = useState(false)
  const [otherPayers, setOtherPayers] = useState<{ memberId: string; amount: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function toggleMember(id: string) {
    setSplitAmong(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function switchToCustom() {
    const numAmount = parseFloat(amount) || 0
    const share = splitAmong.length > 0 ? numAmount / splitAmong.length : 0
    const initial: Record<string, string> = {}
    for (const m of members) {
      initial[m.id] = splitAmong.includes(m.id) ? share.toFixed(2) : '0.00'
    }
    setCustomAmounts(initial)
    setSplitMode('custom')
  }

  function switchToEqual() {
    setSplitMode('equal')
  }

  const subtotal = splitMode === 'equal'
    ? parseFloat(amount) || 0
    : Object.values(customAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0)

  const totalAmount = Math.round(subtotal * (1 + tipPct / 100) * 100) / 100
  const tipAmount = Math.round((totalAmount - subtotal) * 100) / 100

  const finalTotal = roundUp ? Math.ceil(totalAmount) : totalAmount
  const roundUpDelta = Math.round((finalTotal - totalAmount) * 100) / 100

  const scaleFactor = totalAmount > 0 ? finalTotal / totalAmount : 1

  const computedCustomSplits = splitMode === 'custom'
    ? Object.entries(customAmounts)
        .filter(([, v]) => parseFloat(v) > 0)
        .map(([memberId, v]) => ({
          memberId,
          amount: Math.round(parseFloat(v) * (1 + tipPct / 100) * scaleFactor * 100) / 100,
        }))
    : undefined

  const effectiveSplitAmong = splitMode === 'equal'
    ? splitAmong
    : (computedCustomSplits?.map(s => s.memberId) ?? [])

  const perPerson = effectiveSplitAmong.length > 0 && finalTotal > 0
    ? (finalTotal / effectiveSplitAmong.length).toFixed(2)
    : '0.00'

  // Multi-payer derived values
  const otherPayersSum = otherPayers.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
  const primaryAmount = Math.round((finalTotal - otherPayersSum) * 100) / 100

  const allPayerIds = new Set([paidBy, ...otherPayers.map(p => p.memberId)])
  const availableForNew = members.filter(m => !allPayerIds.has(m.id))

  function addOtherPayer() {
    if (availableForNew.length === 0) return
    setOtherPayers(prev => [...prev, { memberId: availableForNew[0].id, amount: '' }])
  }

  function removeOtherPayer(idx: number) {
    setOtherPayers(prev => prev.filter((_, i) => i !== idx))
  }

  function updateOtherPayerMember(idx: number, memberId: string) {
    setOtherPayers(prev => prev.map((p, i) => i === idx ? { ...p, memberId } : p))
  }

  function updateOtherPayerAmount(idx: number, amount: string) {
    setOtherPayers(prev => prev.map((p, i) => i === idx ? { ...p, amount } : p))
  }

  async function handleSubmit() {
    if (!description.trim()) {
      setError('Enter a description')
      return
    }
    if (splitMode === 'equal') {
      const numAmount = parseFloat(amount)
      if (isNaN(numAmount) || numAmount <= 0) {
        setError('Enter a valid amount')
        return
      }
      if (splitAmong.length === 0) {
        setError('Select at least one person')
        return
      }
    } else {
      if (!computedCustomSplits || computedCustomSplits.length === 0) {
        setError('Enter at least one non-zero amount')
        return
      }
    }

    if (primaryAmount <= 0) {
      setError('Other payer amounts exceed total')
      return
    }

    // Check for duplicate payer members
    const payerMemberIds = [paidBy, ...otherPayers.map(p => p.memberId)]
    if (new Set(payerMemberIds).size !== payerMemberIds.length) {
      setError('Duplicate payers')
      return
    }

    const allPayers = [
      { memberId: paidBy, amount: primaryAmount },
      ...otherPayers
        .filter(p => parseFloat(p.amount) > 0)
        .map(p => ({ memberId: p.memberId, amount: Math.round(parseFloat(p.amount) * 100) / 100 })),
    ]

    setSubmitting(true)
    setError('')
    try {
      await onSubmit({
        paidBy,
        amount: finalTotal,
        description: description.trim(),
        splitAmong: effectiveSplitAmong,
        customSplits: computedCustomSplits,
        payers: allPayers,
      })
      onClose()
    } catch {
      setError('Failed to add expense')
    }
    setSubmitting(false)
  }

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

        {/* Who paid? */}
        <div>
          <label className="text-xs font-medium text-ink-soft block mb-2">Who paid?</label>
          <div className="space-y-2">
            {/* Primary payer row */}
            <div className="flex items-center gap-2">
              <select
                className="input flex-1"
                value={paidBy}
                onChange={e => setPaidBy(e.target.value)}
              >
                {members.filter(m => !otherPayers.some(p => p.memberId === m.id)).map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.id === currentMemberId ? ' (you)' : ''}
                  </option>
                ))}
              </select>
              <div className="relative w-28 shrink-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm">{currency}</span>
                <input
                  className="input pl-7 py-1.5 text-sm bg-surface text-ink-muted"
                  type="text"
                  readOnly
                  value={finalTotal > 0 ? primaryAmount.toFixed(2) : ''}
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Additional payer rows */}
            {otherPayers.map((p, idx) => {
              const availableForRow = members.filter(m => m.id === p.memberId || !allPayerIds.has(m.id) || !otherPayers.some((op, oi) => oi !== idx && op.memberId === m.id))
              return (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    className="input flex-1"
                    value={p.memberId}
                    onChange={e => updateOtherPayerMember(idx, e.target.value)}
                  >
                    {members.filter(m => m.id === p.memberId || (m.id !== paidBy && !otherPayers.some((op, oi) => oi !== idx && op.memberId === m.id))).map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name}{m.id === currentMemberId ? ' (you)' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="relative w-28 shrink-0">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm">{currency}</span>
                    <input
                      className="input pl-7 py-1.5 text-sm"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={p.amount}
                      onChange={e => updateOtherPayerAmount(idx, e.target.value)}
                    />
                  </div>
                  <button
                    onClick={() => removeOtherPayer(idx)}
                    className="text-ink-muted hover:text-red text-lg leading-none shrink-0"
                  >
                    &times;
                  </button>
                </div>
              )
            })}

            {/* Add payer button */}
            {availableForNew.length > 0 && (
              <button
                onClick={addOtherPayer}
                className="text-xs text-accent hover:underline"
              >
                + Add payer
              </button>
            )}
          </div>
        </div>

        {/* Split mode tabs */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${splitMode === 'equal' ? 'bg-accent text-white' : 'text-ink-muted hover:bg-surface'}`}
            onClick={switchToEqual}
          >
            Equal split
          </button>
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${splitMode === 'custom' ? 'bg-accent text-white' : 'text-ink-muted hover:bg-surface'}`}
            onClick={switchToCustom}
          >
            Custom split
          </button>
        </div>

        {splitMode === 'equal' ? (
          <>
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
              <label className="text-xs font-medium text-ink-soft block mb-2">
                Split among ({splitAmong.length} people)
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
                    <span className="text-sm">{m.name}{m.id === currentMemberId ? ' (you)' : ''}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div>
            <label className="text-xs font-medium text-ink-soft block mb-2">Amounts per person</label>
            <div className="space-y-2">
              {members.map(m => (
                <div key={m.id} className="flex items-center gap-2">
                  <span className="text-sm flex-1">{m.name}{m.id === currentMemberId ? ' (you)' : ''}</span>
                  <div className="relative w-28">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm">{currency}</span>
                    <input
                      className="input pl-7 py-1.5 text-sm"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={customAmounts[m.id] ?? '0.00'}
                      onChange={e => setCustomAmounts(prev => ({ ...prev, [m.id]: e.target.value }))}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-muted mt-2">
              Subtotal: {currency}{subtotal.toFixed(2)}
            </p>
          </div>
        )}

        {/* Tip selector */}
        <div>
          <label className="text-xs font-medium text-ink-soft block mb-2">Tip</label>
          <div className="flex gap-2">
            {TIP_OPTIONS.map(pct => (
              <button
                key={pct}
                onClick={() => setTipPct(pct)}
                className={`flex-1 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  tipPct === pct
                    ? 'bg-accent text-white border-accent'
                    : 'border-border text-ink-muted hover:bg-surface'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
        {(tipPct > 0 || subtotal > 0) && (
          <div className="bg-surface rounded-lg px-4 py-3 text-sm space-y-1">
            <div className="flex justify-between text-ink-muted">
              <span>Subtotal</span>
              <span>{currency}{subtotal.toFixed(2)}</span>
            </div>
            {tipPct > 0 && (
              <div className="flex justify-between text-ink-muted">
                <span>Tip ({tipPct}%)</span>
                <span>{currency}{tipAmount.toFixed(2)}</span>
              </div>
            )}
            {/* Round up toggle */}
            <div className="flex justify-between items-center text-ink-muted">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={roundUp}
                  onChange={e => setRoundUp(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>Round up</span>
              </label>
              {roundUp && roundUpDelta > 0 && (
                <span className="text-xs">(+{currency}{roundUpDelta.toFixed(2)})</span>
              )}
            </div>
            <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1">
              <span>Total</span>
              <span>{currency}{finalTotal.toFixed(2)}</span>
            </div>
            {splitMode === 'equal' && effectiveSplitAmong.length > 1 && finalTotal > 0 && (
              <p className="text-xs text-ink-muted">{currency}{perPerson} each</p>
            )}
          </div>
        )}

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
