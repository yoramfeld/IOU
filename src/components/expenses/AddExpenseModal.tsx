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
  const [tipPct, setTipPct] = useState(0)
  const [roundUp, setRoundUp] = useState(true)
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal')
  const [splitAmong, setSplitAmong] = useState<string[]>(members.map(m => m.id))
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const [paidAmounts, setPaidAmounts] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // --- Totals ---
  const subtotal = splitMode === 'equal'
    ? parseFloat(amount) || 0
    : Object.values(customAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0)

  const totalAmount = Math.round(subtotal * (1 + tipPct / 100) * 100) / 100
  const tipAmount = Math.round((totalAmount - subtotal) * 100) / 100
  const finalTotal = roundUp ? Math.ceil(totalAmount) : totalAmount
  const roundUpDelta = Math.round((finalTotal - totalAmount) * 100) / 100
  const scaleFactor = totalAmount > 0 ? finalTotal / totalAmount : 1

  // --- Split ---
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

  const perPerson = effectiveSplitAmong.length > 1 && finalTotal > 0
    ? (finalTotal / effectiveSplitAmong.length).toFixed(2)
    : null

  // --- Paid ---
  const totalPaid = members.reduce((s, m) => s + (parseFloat(paidAmounts[m.id]) || 0), 0)
  const unassigned = Math.round((finalTotal - totalPaid) * 100) / 100

  const payers = members
    .filter(m => (parseFloat(paidAmounts[m.id]) || 0) > 0)
    .map(m => ({ memberId: m.id, amount: Math.round(parseFloat(paidAmounts[m.id]) * 100) / 100 }))

  const paidBy = payers[0]?.memberId ?? currentMemberId

  // --- Actions ---
  function fmt(n: number) {
    return Number.isInteger(n) ? String(n) : n.toFixed(2)
  }

  function switchToCustom() {
    const share = splitAmong.length > 0 ? (parseFloat(amount) || 0) / splitAmong.length : 0
    const initial: Record<string, string> = {}
    for (const m of members) {
      initial[m.id] = splitAmong.includes(m.id) ? fmt(share) : '0'
    }
    setCustomAmounts(initial)
    setSplitMode('custom')
  }

  function switchToEqual() {
    // Carry the custom subtotal back as the amount
    if (subtotal > 0) setAmount(subtotal.toFixed(2))
    setSplitMode('equal')
  }

  async function handleSubmit() {
    if (!description.trim()) { setError('Enter a description'); return }

    if (splitMode === 'equal') {
      if ((parseFloat(amount) || 0) <= 0) { setError('Enter a valid amount'); return }
      if (splitAmong.length === 0) { setError('Select at least one person to split among'); return }
    } else {
      if (!computedCustomSplits?.length) { setError('Enter at least one non-zero split amount'); return }
    }

    if (payers.length === 0) { setError('Enter who paid'); return }

    if (Math.abs(unassigned) >= 0.01) {
      setError(unassigned > 0
        ? `${currency}${unassigned.toFixed(2)} still unassigned`
        : `Paid exceeds total by ${currency}${Math.abs(unassigned).toFixed(2)}`)
      return
    }

    setSubmitting(true)
    setError('')
    try {
      await onSubmit({
        paidBy,
        amount: finalTotal,
        description: description.trim(),
        splitAmong: effectiveSplitAmong,
        customSplits: computedCustomSplits,
        payers,
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

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Add expense</h2>
          <button onClick={onClose} className="text-ink-muted text-xl leading-none">&times;</button>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-ink-soft block mb-2">Description</label>
          <input
            className="input"
            placeholder="What was it for?"
            value={description}
            onChange={e => setDescription(e.target.value)}
            autoFocus
          />
        </div>

        {/* Bill amount — editable in equal mode, derived (read-only) in custom mode */}
        <div>
          <label className="text-xs font-medium text-ink-soft block mb-2">Bill</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted text-sm">{currency}</span>
          {splitMode === 'equal' ? (
            <input
              className="input pl-8"
              type="number"
              step="any"
              min="0"
              placeholder="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
          ) : (
            <input
              className="input pl-8 bg-surface text-ink-muted"
              type="text"
              readOnly
              value={subtotal > 0 ? subtotal.toFixed(2) : ''}
              placeholder="0.00"
            />
          )}
        </div>
        </div>

        {/* Tip */}
        <div>
          <label className="text-xs font-medium text-ink-soft block mb-2">Tip</label>
          <div className="flex gap-2">
            {TIP_OPTIONS.map(pct => (
              <button
                key={pct}
                onClick={() => setTipPct(pct)}
                className={`flex-1 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  tipPct === pct ? 'bg-accent text-white border-accent' : 'border-border text-ink-muted hover:bg-surface'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Summary + round up */}
        {subtotal > 0 && (
          <div className="bg-surface rounded-lg px-4 py-3 text-sm space-y-1">
            {tipPct > 0 && (
              <div className="flex justify-between text-ink-muted">
                <span>Subtotal</span>
                <span>{currency}{subtotal.toFixed(2)}</span>
              </div>
            )}
            {tipPct > 0 && (
              <div className="flex justify-between text-ink-muted">
                <span>Tip ({tipPct}%)</span>
                <span>{currency}{tipAmount.toFixed(2)}</span>
              </div>
            )}
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
                <span className="text-xs text-ink-muted">(+{currency}{roundUpDelta.toFixed(2)})</span>
              )}
            </div>
            <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1">
              <span>Total</span>
              <span>{currency}{finalTotal.toFixed(2)}</span>
            </div>
            {perPerson && splitMode === 'equal' && (
              <p className="text-xs text-ink-muted">{currency}{perPerson} each</p>
            )}
          </div>
        )}

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

        {/* Combined member table: split + paid */}
        <div>
          {/* Column headers */}
          <div className="flex items-center gap-2 mb-2">
            <span className="flex-1 text-xs font-medium text-ink-soft">
              {splitMode === 'equal' ? `Split (${splitAmong.length} of ${members.length})` : 'Share'}
            </span>
            {splitMode === 'custom' && (
              <span className="w-20 shrink-0 text-xs font-medium text-ink-soft text-center">Share</span>
            )}
            <span className="w-20 shrink-0 text-xs font-medium text-ink-soft text-center">Paid</span>
          </div>

          <div className="space-y-2">
            {members.map(m => {
              const label = m.name + (m.id === currentMemberId ? ' (you)' : '')
              return (
                <div key={m.id} className="flex items-center gap-2">
                  {/* Split control */}
                  {splitMode === 'equal' ? (
                    <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={splitAmong.includes(m.id)}
                        onChange={() => setSplitAmong(prev =>
                          prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id]
                        )}
                        className="w-4 h-4 shrink-0"
                      />
                      <span className="text-sm truncate">{label}</span>
                    </label>
                  ) : (
                    <>
                      <span className="text-sm flex-1 truncate min-w-0">{label}</span>
                      <div className="relative w-20 shrink-0">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted text-xs">{currency}</span>
                        <input
                          className="input pl-5 py-1.5 text-sm w-full"
                          type="number"
                          step="any"
                          min="0"
                          placeholder="0"
                          value={customAmounts[m.id] ?? ''}
                          onChange={e => setCustomAmounts(prev => ({ ...prev, [m.id]: e.target.value }))}
                        />
                      </div>
                    </>
                  )}

                  {/* Paid input */}
                  <div className="relative w-20 shrink-0">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted text-xs">{currency}</span>
                    <input
                      className="input pl-5 py-1.5 text-sm w-full"
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0"
                      value={paidAmounts[m.id] ?? ''}
                      onFocus={() => {
                        if (unassigned > 0) {
                          setPaidAmounts(prev => ({ ...prev, [m.id]: fmt(unassigned) }))
                        }
                      }}
                      onChange={e => setPaidAmounts(prev => ({ ...prev, [m.id]: e.target.value }))}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Unassigned indicator */}
          {finalTotal > 0 && (
            <div className="flex justify-end mt-2">
              <span className={`text-xs font-medium ${Math.abs(unassigned) < 0.01 ? 'text-green' : 'text-ink-muted'}`}>
                {Math.abs(unassigned) < 0.01
                  ? 'Fully assigned'
                  : unassigned > 0
                    ? `${currency}${unassigned.toFixed(2)} unassigned`
                    : `Over by ${currency}${Math.abs(unassigned).toFixed(2)}`}
              </span>
            </div>
          )}
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
